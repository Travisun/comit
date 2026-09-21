/**
 * SSE 每用户连接槽位的跨进程计数（升级自进程内 Map）。
 *
 * 背景：cluster 多 worker（scripts/cluster-server.mjs）下进程内计数上限
 * 形同 ×worker 稀释 —— 单账号可在每个 worker 各开 5 条长连接。改为 Redis
 * INCR/PEXPIRE 原子计数（key 含 userId），语义与限流器同款降级风格
 * （参考 src/lib/rate-limit 三级降级）：
 *
 *  - Tier 1 Redis：acquire=INCR+PEXPIRE（每连接每次心跳续 TTL），
 *    release=DECR（归零删键），renew=PEXPIRE（自愈：键已过期则重置为 1）；
 *    任何失败（250ms 预算/离线/回复异常）由调用方捕获后落 Tier 2；
 *  - Tier 2 进程内 Map：Redis 未配置或不可用时保持旧行为（per-worker 计
 *    数），绝不因计数故障拒绝/掐断连接之外的路径；
 *  - 崩溃自愈：worker 挂掉没走到 release 时，槽位键靠 TTL（SLOT_TTL_MS）自
 *    动过期，活连接由心跳续期，不需要额外清理任务。
 *
 * 可纯测部分：sseCounterKey / createMemorySlots（含过期语义）/ 三个 Lua 脚
 * 本的形状，单测见 sse-counter.test.ts（注入 fake redis eval）。
 */
import { isRedisConfigured, redisCounterEval } from "@/lib/rate-limit/redis";

/** 键前缀：mb:sse:conns:<userId>，与限流键（mb:rl:）同风格隔离 */
export const SSE_COUNTER_KEY_PREFIX = "mb:sse:conns:";

/**
 * 槽位键 TTL：≥ 心跳周期（25s）的 4 倍余量。活连接每次心跳 renew 续期；
 * 进程崩溃后残槽至多 SLOT_TTL_MS 后自动释放。
 */
export const SLOT_TTL_MS = 120_000;

export function sseCounterKey(userId: string): string {
  return `${SSE_COUNTER_KEY_PREFIX}${userId}`;
}

/** acquire：INCR + 无条件 PEXPIRE（心跳/新连接都续期，防残键永不过期） */
export const ACQUIRE_LUA =
  "redis.call('INCR', KEYS[1]) " +
  "local c = redis.call('GET', KEYS[1]) " +
  "redis.call('PEXPIRE', KEYS[1], ARGV[1]) " +
  "return tonumber(c)";

/** release：DECR，归零即删键；负数（重复释放/键已过期后迟到）钳到 0 */
export const RELEASE_LUA =
  "local c = redis.call('DECR', KEYS[1]) " +
  "if c <= 0 then redis.call('DEL', KEYS[1]) return 0 end " +
  "redis.call('PEXPIRE', KEYS[1], ARGV[1]) " +
  "return c";

/** renew：仅续 TTL；键已因 TTL 过期则重置为 1（活连接自愈，宁可少计不误删） */
export const RENEW_LUA =
  "if redis.call('EXISTS', KEYS[1]) == 1 then " +
  "  redis.call('PEXPIRE', KEYS[1], ARGV[1]) " +
  "  return tonumber(redis.call('GET', KEYS[1])) " +
  "end " +
  "redis.call('SET', KEYS[1], '1', 'PEX', ARGV[1]) " +
  "return 1";

/** 槽位计数驱动接口（Redis / 内存两实现，route 侧只认此接口） */
export interface SseSlots {
  /** 占用一个槽位，返回占用后全局计数（可能超上限，由调用方决定挤占/拒绝） */
  acquire(userId: string): Promise<number>;
  /** 释放槽位，返回释放后计数 */
  release(userId: string): Promise<number>;
  /** 续期槽位（心跳调用），返回当前计数 */
  renew(userId: string): Promise<number>;
}

/* ------------------------------ 内存降级层 ------------------------------ */

interface MemoryBucket {
  count: number;
  /** 过期时刻：由 renew/acquire 刷新（语义对齐 Redis 的 PEXPIRE） */
  expireAt: number;
}

const g = globalThis as unknown as { __mbSseSlotsStore?: Map<string, MemoryBucket> };

/** 清理过期桶 + 防膨胀（风格对照 rate-limit.ts 的 prune） */
function pruneMemorySlots(store: Map<string, MemoryBucket>, now: number): void {
  for (const [k, b] of store) {
    if (b.expireAt <= now) store.delete(k);
  }
  if (store.size > 10_000) {
    const excess = store.size - 10_000;
    let dropped = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++dropped >= excess) break;
    }
  }
}

/** 进程内槽位计数（测试可直接构造独立实例；生产默认挂 globalThis 单例） */
export function createMemorySlots(
  store: Map<string, MemoryBucket> = (g.__mbSseSlotsStore ??= new Map()),
  now: () => number = Date.now,
): SseSlots {
  const bucket = (userId: string): MemoryBucket => {
    const t = now();
    const key = sseCounterKey(userId);
    let b = store.get(key);
    if (!b || b.expireAt <= t) {
      if (store.size > 1_000) pruneMemorySlots(store, t);
      b = { count: 0, expireAt: t + SLOT_TTL_MS };
      store.set(key, b);
    }
    return b;
  };
  return {
    async acquire(userId) {
      const b = bucket(userId);
      b.count += 1;
      b.expireAt = now() + SLOT_TTL_MS;
      return b.count;
    },
    async release(userId) {
      const key = sseCounterKey(userId);
      const b = store.get(key);
      if (!b) return 0;
      b.count = Math.max(0, b.count - 1);
      if (b.count === 0) store.delete(key);
      return b.count;
    },
    async renew(userId) {
      const b = bucket(userId); // 过期后重建 count=0 → 重置为 1（对齐 RENEW_LUA 自愈）
      if (b.count < 1) b.count = 1;
      b.expireAt = now() + SLOT_TTL_MS;
      return b.count;
    },
  };
}

/* ------------------------------ 组装入口 ------------------------------ */

/**
 * 取当前进程的槽位计数入口：REDIS_URL 已配置 → Redis 驱动（失败时调用方
 * 可用 fallback 内存驱动补救单次操作）；未配置 → 纯内存驱动（旧行为）。
 *
 * Redis 路径的每个方法内部：try redis，catch → 降级内存层完成本次操作并打
 * 限频告警（降级只改变计数共享范围，不抛错、不阻断连接）。
 */
export interface SseSlotManager extends SseSlots {
  /** 本次操作实际使用的驱动（观测/测试用） */
  lastDriver(): "redis" | "memory";
}

let lastWarn = 0;
function warnDegrade(err: unknown): void {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn("[sse-counter] Redis unavailable — falling back to in-process slot count:", err);
}

export function createSseSlotManager(
  memory: SseSlots = createMemorySlots(),
  redisAvailable: () => boolean = isRedisConfigured,
  evalOp: (script: string, key: string, ttlMs: number) => Promise<number> = async (s, k, t) =>
    redisCounterEval(s, k, t),
): SseSlotManager {
  let last: "redis" | "memory" = "memory";
  const op =
    (script: string, fallback: (userId: string) => Promise<number>) =>
    async (userId: string): Promise<number> => {
      if (redisAvailable()) {
        try {
          const n = await evalOp(script, sseCounterKey(userId), SLOT_TTL_MS);
          last = "redis";
          return n;
        } catch (err) {
          warnDegrade(err);
        }
      }
      last = "memory";
      return fallback(userId);
    };
  return {
    acquire: op(ACQUIRE_LUA, (u) => memory.acquire(u)),
    release: op(RELEASE_LUA, (u) => memory.release(u)),
    renew: op(RENEW_LUA, (u) => memory.renew(u)),
    lastDriver: () => last,
  };
}

/** 生产共享实例（globalThis 守卫：dev HMR 多次求值共享同一内存降级层） */
const gp = globalThis as unknown as { __mbSseSlotManager?: SseSlotManager };
export function sseSlots(): SseSlotManager {
  return (gp.__mbSseSlotManager ??= createSseSlotManager());
}
