import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tooMany } from "@/core/errors";
import { isRedisConfigured, redisHit, redisUsableNow } from "./rate-limit/redis";

/**
 * Distributed fixed-window rate limiter with a three-tier driver chain:
 * Redis (opt-in) → Postgres (schema: rate_limits) → in-process Map.
 *
 * 三级驱动链的分布式固定窗口限流：多 worker（scripts/cluster-server.mjs）共享
 * 同一计数，阈值不被 worker 数稀释。
 *
 * 配置方法：设环境变量 REDIS_URL 即启用 Redis 驱动（Tier 1，见
 * rate-limit/redis.ts，ioredis 懒建连单例）；未配置时完全不触碰 Redis
 * （零建连、零 import 副作用），行为与旧的 PG→内存两级行为一致。
 *
 * 语义一致性：三级均为 epoch 对齐的固定窗口（windowStart =
 * floor(now/windowMs)*windowMs，见 rateLimit 注释），窗口边界跨驱动一致；
 * 降级只改变计数的共享范围（Redis 全局共享 → PG 跨 worker 共享 → 内存
 * per-worker），不改变阈值与窗口语义。
 *
 * 降级行为：每级操作受 250ms Promise.race 预算约束，失败（异常/超时/离线/
 * 回复异常）即落到下一级，绝不抛 5xx、绝不阻塞请求；每级降级打限频日志
 * （每 driver+key 每分钟一条，标注驱动层级）。Redis 断线由 ioredis
 * retryStrategy 后台重连（封顶 30s），恢复后自动回到 Redis 驱动。
 */

/** DB 判定超时：超过即降级进程内计数，避免慢查询拖住请求路径 */
const DB_TIMEOUT_MS = 250;

/** 降级警告日志限频：每 key 每分钟最多一条，避免 DB 故障时刷屏 */
const DEGRADE_LOG_INTERVAL_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as {
  __mbRateLimitStore?: Map<string, Bucket>;
  __mbRateLimitDegradeLog?: Map<string, number>;
};

/** 降级路径存储：进程内固定窗口计数（语义与旧版 rateLimit 一致，per-worker） */
const store: Map<string, Bucket> = g.__mbRateLimitStore ?? new Map();
g.__mbRateLimitStore = store;

/** 降级日志去重表（key → 上次告警时间） */
const degradeLog: Map<string, number> = g.__mbRateLimitDegradeLog ?? new Map();
g.__mbRateLimitDegradeLog = degradeLog;

const MAX_KEYS = 10_000;

/**
 * 内存降级是 per-worker 计数（降级只发生在 Redis 与 PG 双双不可用时，往往
 * 正是攻击窗口），cluster 多 worker 下同一客户端的请求被分摊到 N 个进程，
 * 实际可打满 N × limit。按 WEB_CONCURRENCY（cluster fork 时已注入）折算
 * 单进程阈值，保底 1 —— 全局总阈值 ≈ 配置阈值，宁紧勿松。
 */
function memLimit(limit: number): number {
  const workers = Number(process.env.WEB_CONCURRENCY);
  const n = Number.isFinite(workers) && workers >= 1 ? Math.floor(workers) : 1;
  return Math.max(1, Math.ceil(limit / n));
}

function prune(now: number) {
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
  // still oversized (many live buckets) — drop oldest entries
  if (store.size > MAX_KEYS) {
    const excess = store.size - MAX_KEYS;
    let dropped = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++dropped >= excess) break;
    }
  }
}

/** 降级路径计数：窗口与 PG/Redis 一致按 epoch 对齐，超限抛 429 */
function memRateLimit(key: string, limit: number, windowMs: number): void {
  const effective = memLimit(limit);
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (store.size > MAX_KEYS) prune(now);
    store.set(key, { count: 1, resetAt: windowStart + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > effective) throw tooMany();
}

/**
 * 警告日志限频（每 driver+key 每分钟一次，标注驱动层级）；超限时先清理过期
 * 条目防膨胀
 */
function logDegrade(driver: "redis" | "pg", key: string, err: unknown) {
  const now = Date.now();
  const dedupeKey = `${driver}:${key}`;
  if (now - (degradeLog.get(dedupeKey) ?? 0) < DEGRADE_LOG_INTERVAL_MS) return;
  if (degradeLog.size > MAX_KEYS) {
    for (const [k, t] of degradeLog) {
      if (now - t >= DEGRADE_LOG_INTERVAL_MS) degradeLog.delete(k);
    }
  }
  degradeLog.set(dedupeKey, now);
  const message =
    driver === "redis"
      ? `[rate-limit] Redis unavailable — falling back to PG counter:`
      : `[rate-limit] PG unavailable — falling back to in-process counter:`;
  console.warn(message, err);
}

/**
 * Count one hit against `key`; throws a 429 AppError when `limit` is exceeded
 * within `windowMs`. Call (and `await`) at the top of a handler, before work.
 *
 * 驱动链：Redis（若配置，见 rate-limit/redis.ts）→ PG upsert → 进程内计数。
 *
 * 窗口对齐：起点按 windowMs 对齐到 epoch（floor(now/windowMs)*windowMs，JS
 * 计算后以 timestamptz 参数下发），所有实例窗口边界一致；PG 侧 upsert 单语句
 * 原子 —— 窗口已翻页则重置为 1，否则自增，RETURNING count 由调用侧比较阈值；
 * Redis 侧为同公式窗口键上的单次原子 EVAL（INCR + 首次 PEXPIRE）。
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  let count: number | undefined;
  // Tier 1：Redis（opt-in）。内含 250ms race；任何失败/超时在下一行捕获后落 PG
  if (isRedisConfigured()) {
    try {
      count = await redisHit(key, windowMs);
    } catch (err) {
      // Redis 未就绪/超时/异常 → 降级 PG（绝不以 5xx 逃逸）
      count = undefined;
      logDegrade("redis", key, err);
    }
  }
  if (count === undefined) {
    // Tier 2：PG（rate_limits upsert）。窗口起点与 Redis 驱动同公式对齐
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    try {
      // op 的构造必须进 try：模板/连接异常不能以 5xx 逃逸，统一走降级路径
      const op = db.execute(sql`
        INSERT INTO rate_limits (key, window_start, count)
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limits.window_start < ${windowStart} THEN 1 ELSE rate_limits.count + 1 END,
          window_start = CASE WHEN rate_limits.window_start < ${windowStart} THEN ${windowStart} ELSE rate_limits.window_start END
        RETURNING count
      `);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`rate-limit PG timeout (${DB_TIMEOUT_MS}ms)`)), DB_TIMEOUT_MS);
      });
      op.catch(() => {}); // race 落选方的迟到 rejection 不能变成 unhandledRejection
      const res = await Promise.race([op, timeout]);
      count = Number(res.rows[0]?.count ?? 0);
    } catch (err) {
      // DB 异常/超时 → 降级进程内计数（超限同样抛 429，但绝不抛 5xx）
      logDegrade("pg", key, err);
      return memRateLimit(key, limit, windowMs);
    }
  }
  if (count > limit) throw tooMany();
}

/**
 * 限流器驱动状态（供 /api/health 等观测端点）。同步可判定，无需探测：
 * driver 表示"下一次调用将使用的驱动"的静态最优判断 —— Redis 已配置且不在
 * 已知故障态（重连中/冷却中）→ redis；否则配置了 DATABASE_URL → pg；两者
 * 皆缺 → memory。运行中的瞬时故障降级无法静态预知，以限频降级日志为准。
 */
export async function limiterStatus(): Promise<{
  driver: "redis" | "pg" | "memory";
  redisConfigured: boolean;
}> {
  const redisConfigured = isRedisConfigured();
  const driver = redisConfigured
    ? redisUsableNow()
      ? "redis"
      : "pg"
    : process.env.DATABASE_URL
      ? "pg"
      : "memory";
  return { driver, redisConfigured };
}

/**
 * 真实客户端 IP 解析已迁移至 src/lib/net/real-ip.ts（部署形态感知：
 * TRUST_PROXY = cloudflare | nginx | direct），此处保留兼容 re-export，
 * 现有 `import { clientIp } from "@/lib/rate-limit"` 的调用方无需改动。
 */
export { clientIp, trustProxyMode, UNKNOWN_IP } from "@/lib/net/real-ip";
export type { TrustProxyMode } from "@/lib/net/real-ip";
