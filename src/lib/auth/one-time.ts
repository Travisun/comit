import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { oneTimeChallenges } from "@/db/schema";
import { isRedisConfigured, redisDel, redisGetdel, redisSetex } from "@/lib/rate-limit/redis";

/**
 * 一次性键存储（one-time key store）——签发时写入、验证时原子消费，消费失败
 * 即视为重放。驱动链复用限流器的三级降级模式（Redis → PG → 进程内存，
 * 见 src/lib/rate-limit.ts）：
 *
 *  - Tier 1 Redis：签发 SETEX（mb:otc: 前缀键），验证 GETDEL 原子消费；
 *  - Tier 2 PG：one_time_challenges 表（签发 INSERT，验证 DELETE … RETURNING
 *    原子消费），250ms 超时预算与限流器一致；
 *  - Tier 3 内存 Map（带 TTL 与容量上限）：Redis/PG 双双不可用时的最后防线，
 *    cluster 多 worker 下 per-worker（与内存限流同款局限，宁拒勿漏）。
 *
 * 签发对全部可达层级写穿（write-through）：某层签发时不可用、恢复后消费
 * 拿不到键会造成误拒，写穿消除该错位；消费自顶向下逐层尝试、任一层原子
 * 命中即成功，并尽力清理其余层残留。所有层级均未命中 ⇒ 重放/过期 ⇒ false。
 * 任何层级故障绝不向外抛异常（请求路径语义由调用方决定）。
 */

/** 降级告警限频：每层级每分钟至多一条，避免故障期刷屏 */
const WARN_INTERVAL_MS = 60_000;
const lastWarn = new Map<string, number>();
function warnThrottled(tier: string, err: unknown): void {
  const now = Date.now();
  if (now - (lastWarn.get(tier) ?? 0) < WARN_INTERVAL_MS) return;
  lastWarn.set(tier, now);
  console.warn(`[one-time] ${tier} unavailable — degrading to next tier:`, err);
}

/** PG 判定超时：与限流器 DB_TIMEOUT_MS 同值，超时即降级内存 */
const DB_TIMEOUT_MS = 250;

const MAX_KEYS = 10_000;

/* ------------------------------ 内存层级 ------------------------------- */

const g = globalThis as unknown as { __mbOneTimeStore?: Map<string, number> };
/** key → 绝对过期毫秒时间戳（签发写入时计算） */
const memStore: Map<string, number> = g.__mbOneTimeStore ?? new Map();
g.__mbOneTimeStore = memStore;

function memPut(key: string, expiresAtMs: number): void {
  if (memStore.size > MAX_KEYS) {
    const now = Date.now();
    for (const [k, exp] of memStore) {
      if (exp <= now) memStore.delete(k);
    }
    if (memStore.size > MAX_KEYS) {
      const excess = memStore.size - MAX_KEYS;
      let dropped = 0;
      for (const k of memStore.keys()) {
        memStore.delete(k);
        if (++dropped >= excess) break;
      }
    }
  }
  memStore.set(key, expiresAtMs);
}

function memConsume(key: string): boolean {
  const exp = memStore.get(key);
  if (exp === undefined) return false;
  memStore.delete(key);
  return exp > Date.now();
}

/* ------------------------------- PG 层级 ------------------------------- */

async function pgPut(key: string, ttlSec: number): Promise<void> {
  const op = db
    .insert(oneTimeChallenges)
    .values({ key, expiresAt: new Date(Date.now() + ttlSec * 1000) })
    .onConflictDoNothing({ target: oneTimeChallenges.key });
  await withTimeout(op as unknown as PromiseLike<unknown>, "one-time PG insert");
}

/** DELETE … RETURNING 单语句原子消费：返回行 ⇒ 首次消费成功 */
async function pgConsume(key: string): Promise<boolean> {
  const op = db
    .delete(oneTimeChallenges)
    .where(and(eq(oneTimeChallenges.key, key), gt(oneTimeChallenges.expiresAt, new Date())))
    .returning({ key: oneTimeChallenges.key });
  const rows = await withTimeout(op as unknown as PromiseLike<{ key: string }[]>, "one-time PG delete");
  return rows.length > 0;
}

async function pgDel(key: string): Promise<void> {
  await db.delete(oneTimeChallenges).where(eq(oneTimeChallenges.key, key));
}

async function withTimeout<T>(opLike: PromiseLike<T>, label: string): Promise<T> {
  const op = Promise.resolve(opLike);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    op.catch(() => {}); // race 落选方的迟到 rejection 不能变成 unhandledRejection
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout (${DB_TIMEOUT_MS}ms)`)), DB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- 公共 API ------------------------------ */

/**
 * 签发一次性键：内存层必写，Redis/PG 尽力写穿（失败仅记日志，不抛出）。
 * 调用方 await 后继续签发流程——降级路径下最坏只剩内存层，语义不破坏。
 */
export async function issueOneTimeKey(key: string, ttlSec: number): Promise<void> {
  memPut(key, Date.now() + ttlSec * 1000);
  const jobs: Promise<unknown>[] = [];
  if (isRedisConfigured()) {
    jobs.push(
      redisSetex(key, ttlSec, "1").catch((err: unknown) => warnThrottled("redis", err)),
    );
  }
  jobs.push(pgPut(key, ttlSec).catch((err: unknown) => warnThrottled("pg", err)));
  await Promise.all(jobs);
}

/**
 * 消费一次性键。true = 首次消费（挑战有效）；false = 重放/已过期/从未签发。
 * 自顶向下逐层尝试（Redis 命中 → PG 命中 → 内存命中），任一层原子命中即
 * 成功并尽力清理其余层；全部层级给出"未命中"判定才返回 false。
 * 层级故障不算未命中：继续向下一级要判定。
 */
export async function consumeOneTimeKey(key: string): Promise<boolean> {
  // Tier 1：Redis（GETDEL 原子消费）
  if (isRedisConfigured()) {
    try {
      const hit = await redisGetdel(key);
      if (hit) {
        // 写穿残留清理（尽力而为）：避免同一键在低层被再次消费
        void pgDel(key).catch(() => undefined);
        memStore.delete(key);
        return true;
      }
      // Redis 正常应答"无此键" ⇒ 可能签发于 Redis 故障期（键只在低层），
      // 继续向下层求证；下层同样未命中才判重放
    } catch (err) {
      warnThrottled("redis", err);
    }
  }
  // Tier 2：PG（DELETE RETURNING 原子消费）
  try {
    const hit = await pgConsume(key);
    if (hit) {
      if (isRedisConfigured()) void redisDel(key).catch(() => undefined);
      memStore.delete(key);
      return true;
    }
  } catch (err) {
    warnThrottled("pg", err);
  }
  // Tier 3：内存（per-worker 最后防线）
  return memConsume(key);
}
