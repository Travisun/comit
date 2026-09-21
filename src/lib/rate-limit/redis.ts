/**
 * Redis driver for the rate limiter — Tier 1, opt-in via REDIS_URL.
 * 同时承载通用一次性键原语（setex/getdel/del，见文件底部），供
 * src/lib/auth/one-time.ts 的 passkey challenge 重放防护复用同一客户端。
 *
 * 限流器的一级驱动（opt-in）：仅当环境变量 REDIS_URL 存在时启用，风格对照
 * src/core/pg-listen.ts（懒启动 + globalThis 单例 + 后台退避重连）。
 *
 * 设计要点：
 * - 零副作用 opt-in：模块顶层不 import ioredis，首次调用才动态 import 并建连；
 *   REDIS_URL 缺失时本模块完全不被触碰（不加载依赖、不建连），未安装 ioredis
 *   的场景/构建期也不受影响；
 * - 固定窗口语义与 PG 路径一致：windowStart = floor(now/windowMs)*windowMs
 *   （epoch 对齐，所有实例窗口边界一致），单次 EVAL 原子完成 INCR + 首次
 *   PEXPIRE，键自带 TTL 自动过期免清理；
 * - 断线自愈：已建立连接的断开由 ioredis retryStrategy 后台重连（0.5s 起步
 *   指数退避，封顶 30s），恢复后自动回到 Redis 驱动；重连/建连等待期的命令经
 *   enableOfflineQueue=false 快速失败，请求侧立即降级 PG，不积压不阻塞；
 * - 故障边界：redisHit 的任何失败以 throw 通知 rate-limit.ts 捕获降级
 *   （429/5xx 语义由上层保证），本模块自身绝不抛给请求路径之外。
 */
import type Redis from "ioredis";

/** 键前缀：mb:rl:<key>:<windowStart>，避免与业务键冲突 */
export const REDIS_KEY_PREFIX = "mb:rl:";

/** 驱动判定超时：与 PG 路径（DB_TIMEOUT_MS）一致，超时即降级下一级 */
const REDIS_TIMEOUT_MS = 250;

/** 初次建连失败后的冷却：期间请求直接跳过 Redis（初连失败在 ioredis 是终态） */
const INIT_COOLDOWN_MS = 1_000;

/** 连接错误告警限频：每分钟至多一条，重连风暴不刷屏 */
const CONN_ERR_LOG_INTERVAL_MS = 60_000;

/**
 * 固定窗口原子脚本（语义与 PG upsert 一致）：INCR 计数，返回 1（窗口首个
 * 命中）时补 PEXPIRE，TTL 到期键自清，无需清理任务。
 */
const FIXED_WINDOW_LUA =
  "local c = redis.call('INCR', KEYS[1]) " +
  "if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end " +
  "return c";

interface RedisState {
  /** 已就绪/重连中的客户端；初次建连失败（终态 end）后置空待重建 */
  client?: Redis;
  /** 进行中的初始化（动态 import + 建连），并发调用共享同一次尝试 */
  initPromise?: Promise<Redis>;
  /** 冷却截止时间：此前不再发起新的建连尝试 */
  cooldownUntil?: number;
  /** 连接错误上次告警时间（限频用） */
  lastConnErrLog?: number;
  /** 经历过连接故障：恢复（ready）时打一条 recovery 日志 */
  hadConnError?: boolean;
}

// globalThis 单例守卫：跟随项目 HMR 模式（dev 下模块可能被多次求值），
// 保证一个进程只有一个限流 Redis 客户端。
const g = globalThis as unknown as { __mbRateLimitRedis?: RedisState };
const state: RedisState = (g.__mbRateLimitRedis ??= {});

/** Redis 驱动是否被启用（纯配置判定，同步无副作用） */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/** 已告警过的事件（init 失败每轮冷却至多一条） */
const warned = new Set<string>();
function warnOnce(key: string, message: string, err?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message, err ?? "");
}

/** 创建客户端并建连（仅由 ensureClient 调用）。失败时清理半开实例。 */
async function initClient(url: string): Promise<Redis> {
  // 动态 import：保证未安装/未配置场景零 import 副作用（顶层不加载 ioredis）
  const { default: RedisCtor } = await import("ioredis");
  const client = new RedisCtor(url, {
    // 显式 connect() 前不建连：纯静态渲染进程零连接，跟随 pg-listen 的懒启动
    lazyConnect: true,
    // 非 ready 状态的命令立即 reject（不进离线队列）：请求侧拿到快速失败，
    // 在 250ms 预算内降级 PG，避免断线期间命令积压、恢复后迟到重放
    enableOfflineQueue: false,
    // 断线后台重连：0.5s 起步指数退避，封顶 30s（times 从 1 开始）
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** (times - 1)),
  });
  // ioredis 断连/重连会发 error 事件：限频告警，绝不外抛（无监听器会变成
  // uncaughtException，必须挂上）
  client.on("error", (err) => {
    state.hadConnError = true;
    const now = Date.now();
    if (now - (state.lastConnErrLog ?? 0) < CONN_ERR_LOG_INTERVAL_MS) return;
    state.lastConnErrLog = now;
    console.warn("[rate-limit] redis connection error (will auto-reconnect):", err);
  });
  client.on("ready", () => {
    // 首次就绪静默；故障恢复（断线重连成功）后打一条，便于观测回到 Redis 驱动
    if (state.hadConnError) {
      state.hadConnError = false;
      console.log("[rate-limit] redis reconnected — driver restored to redis");
    }
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    // 初次建连失败在 ioredis 是终态（status=end，不会自动重试）：丢弃实例，
    // 由调用方记冷却，后续请求探测式重建
    client.disconnect();
    throw err;
  }
}

/**
 * 取可用客户端（懒初始化入口，幂等）：已有非终态客户端直接复用（含
 * connecting/reconnecting —— 命令会快速失败并降级，后台重连不受影响）；
 * 否则初始化。失败 throw，由 redisHit 的调用方捕获降级。
 */
function ensureClient(): Promise<Redis> {
  const existing = state.client;
  if (existing && existing.status !== "end") return Promise.resolve(existing);
  const url = process.env.REDIS_URL;
  if (!url) return Promise.reject(new Error("rate-limit redis: REDIS_URL missing"));
  if (state.initPromise) return state.initPromise;
  // 冷却期内不重复握手：Redis 宕机时每秒至多一次探测，避免每请求都发起 TCP
  if (Date.now() < (state.cooldownUntil ?? 0)) {
    return Promise.reject(new Error("rate-limit redis: backing off after failed init"));
  }
  warnOnce(
    "init",
    "[rate-limit] redis connecting (first use after cold start / failure)...",
  );
  state.initPromise = (async () => {
    try {
      const client = await initClient(url);
      state.client = client;
      state.cooldownUntil = undefined;
      return client;
    } catch (err) {
      state.cooldownUntil = Date.now() + INIT_COOLDOWN_MS;
      warnOnce("init-failed", "[rate-limit] redis init failed — degrading to PG", err);
      throw err;
    } finally {
      // 用完即清：下一次调用（含冷却后的探测）重新发起
      state.initPromise = undefined;
    }
  })();
  return state.initPromise;
}

/**
 * Tier 1 固定窗口计数：返回本窗口累计命中数（与 PG 的 RETURNING count 同义）。
 * 任何失败（未就绪/超时/回复异常）throw 给 rate-limit.ts 捕获后降级 PG；
 * 内含 250ms Promise.race，慢命令绝不阻塞请求路径超过预算。
 */
export async function redisHit(key: string, windowMs: number): Promise<number> {
  const client = await ensureClient();
  // 窗口对齐：与 PG 路径完全相同的 epoch 对齐公式，边界跨驱动一致
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const redisKey = `${REDIS_KEY_PREFIX}${key}:${windowStart}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 单次原子 EVAL 替代 pipeline：PEXPIRE 仅在 INCR 返回 1 时执行（pipeline
    // 无法条件执行，无条件 PEXPIRE 会把 TTL 随每次命中刷新、拉长窗口）
    const op: Promise<unknown> = client.eval(FIXED_WINDOW_LUA, 1, redisKey, String(windowMs));
    op.catch(() => {}); // race 落选方的迟到 rejection 不能变成 unhandledRejection
    const res = await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`rate-limit redis timeout (${REDIS_TIMEOUT_MS}ms)`)),
          REDIS_TIMEOUT_MS,
        );
      }),
    ]);
    const count = Number(res ?? 0);
    // INCR 首个命中即 1；0/NaN 说明回复异常，按驱动故障处理（降级而非误判）
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`rate-limit redis: unexpected INCR reply: ${String(res)}`);
    }
    return count;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通用原子计数脚本入口（供限流之外的跨进程计数复用，如 SSE 每用户连接槽位
 * src/lib/realtime/sse-counter.ts）：脚本内自带 INCR/DECR + PEXPIRE，调用方
 * 传入固定 key（槽位计数不是窗口计数，不带 windowStart 后缀）。与 redisHit
 * 同款故障边界：250ms 预算、任何失败 throw 给调用方降级，本函数绝不吞错。
 */
export async function redisCounterEval(script: string, key: string, ttlMs: number): Promise<number> {
  const client = await ensureClient();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const op: Promise<unknown> = client.eval(script, 1, key, String(ttlMs));
    op.catch(() => {}); // race 落选方的迟到 rejection 不能变成 unhandledRejection
    const res = await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`rate-limit redis timeout (${REDIS_TIMEOUT_MS}ms)`)),
          REDIS_TIMEOUT_MS,
        );
      }),
    ]);
    const count = Number(res ?? 0);
    if (!Number.isFinite(count)) {
      throw new Error(`rate-limit redis: unexpected counter reply: ${String(res)}`);
    }
    return count;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 同步 best-effort 判定"下一次调用是否会先尝试 Redis"（供 limiterStatus）：
 * 未配置 → false；懒未建连/建连中/已就绪 → true；正在重连或已终态 → false
 * （命令会快速失败，下一次调用预计落到 PG）。
 */
export function redisUsableNow(): boolean {
  if (!isRedisConfigured()) return false;
  // 冷却期内（刚发生过建连失败）：下一次调用将直接跳过 Redis、快速降级 PG
  if (Date.now() < (state.cooldownUntil ?? 0)) return false;
  const client = state.client;
  if (!client) return true; // 懒启动：下一次调用将发起 Redis 尝试
  return client.status === "ready" || client.status === "connect" || client.status === "connecting";
}

/* ========================= 通用一次性键原语 ============================ */
/**
 * 供一次性挑战消费（src/lib/auth/one-time.ts，passkey challenge 重放防护）
 * 复用的原子原语。与限流驱动共享同一懒建连客户端（连接管理/退避重连/
 * 快速失败语义一致），键由调用方自带前缀，互不冲突。
 */

/** 单次操作超时预算：与限流一致 250ms，超时 throw 由调用方降级下一级 */
async function withBudget<T>(op: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    op.catch(() => {}); // race 落选方的迟到 rejection 不能变成 unhandledRejection
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout (${REDIS_TIMEOUT_MS}ms)`)), REDIS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** SETEX 写入（签发一次性键）。失败 throw，由调用方降级。 */
export async function redisSetex(key: string, ttlSec: number, value: string): Promise<void> {
  const client = await ensureClient();
  await withBudget(client.set(key, value, "EX", ttlSec), "redis SETEX");
}

/**
 * 原子取删（验证时一次性消费）：GETDEL 需要 Redis ≥6.2，用 EVAL 兼容旧版——
 * GET + 命中即 DEL 在同一脚本内原子完成。返回 true=消费成功（键存在），
 * false=键不存在（重放/已过期）。失败 throw，由调用方降级。
 */
const GETDEL_LUA =
  "local v = redis.call('GET', KEYS[1]) if v then redis.call('DEL', KEYS[1]) return 1 else return 0 end";

export async function redisGetdel(key: string): Promise<boolean> {
  const client = await ensureClient();
  const res = await withBudget(client.eval(GETDEL_LUA, 1, key), "redis GETDEL-eval");
  return Number(res) === 1;
}

/** 尽力删除（跨层级消费时清理低层残留）。失败 throw，由调用方吞掉。 */
export async function redisDel(key: string): Promise<void> {
  const client = await ensureClient();
  await withBudget(client.del(key), "redis DEL");
}
