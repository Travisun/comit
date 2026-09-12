import { tooMany } from "@/core/errors";

/**
 * Minimal in-memory fixed-window rate limiter (per process). Good enough for
 * single-instance deployments; swap for Redis when scaling horizontally.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __mbRateLimitStore?: Map<string, Bucket> };
const store: Map<string, Bucket> = g.__mbRateLimitStore ?? new Map();
g.__mbRateLimitStore = store;

const MAX_KEYS = 10_000;

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

/**
 * Count one hit against `key`; throws a 429 AppError when `limit` is exceeded
 * within `windowMs`. Call at the top of a handler, before doing work.
 */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (store.size > MAX_KEYS) prune(now);
    store.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw tooMany();
}

/** Best-effort client IP for rate-limit keys (proxy headers first). */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
