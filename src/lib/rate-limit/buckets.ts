import { rateLimit } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import { RATE_BUCKETS, type BucketName, type BucketOverride, type RateBucket } from "@/lib/rate-limit/bucket-manifest";

/**
 * Named rate-limit buckets — 收敛各路由散落的硬编码限流阈值。
 *
 * 每个调用点只声明「用哪个桶 + 主体是谁」（identity），阈值/窗口一律取桶默认，
 * 后台可通过设置键 `ratelimit.buckets` 按桶名覆写（10s 生效，复用 settings 的
 * 进程缓存，成本≈0）。底层仍是 `rateLimit(key, limit, windowMs)` 契约：
 * PG 固定窗口、超限抛 429、DB 故障降级进程内计数。
 *
 * 桶的形状与默认值单源于 `bucket-manifest.ts`（纯数据、客户端安全）；
 * 本文件只保留服务端执行逻辑（覆写解析 + 限流计数）。
 */

/**
 * 设置键 ratelimit.buckets 的形状：桶名 → 覆写，未列出的桶用内置默认值。
 * 键在运行时按 string 索引（DB 里的历史脏数据由 sanitize 兜底忽略）。
 */
export type BucketOverrides = Partial<Record<string, BucketOverride>>;

export { RATE_BUCKETS };
export type { BucketName, BucketOverride, RateBucket };

/** 桶名 → 桶定义的查找表（模块加载时构建一次） */
const BUCKET_MAP = Object.fromEntries(RATE_BUCKETS.map((b) => [b.name, b])) as Record<
  BucketName,
  RateBucket
>;

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/**
 * DB 值防御：历史脏行（先于 admin 校验写入）形状不可信，形状不完整的
 * 覆写整条忽略、回落桶默认 —— 限流永远可用，绝不让坏配置放大阈值。
 */
function sanitizeOverride(v: unknown): BucketOverride | null {
  if (typeof v !== "object" || v === null) return null;
  const { limit, windowSec } = v as Record<string, unknown>;
  if (!isPositiveInt(limit) || !isPositiveInt(windowSec)) return null;
  return { limit, windowSec };
}

/**
 * Count one hit against a named bucket for `identity`; throws a 429 AppError
 * on exceed（与 rateLimit 契约一致）。identity 由调用点决定：IP 用 clientIp(req)、
 * 登录态用 user.id、MCP 用 tokenId。键前缀带桶名（`${bucket}:${identity}`），
 * 保证不同桶的同一主体互不串号、全局唯一。
 */
export async function rateLimitBucket(bucket: BucketName, identity: string): Promise<void> {
  const base = BUCKET_MAP[bucket];
  let override: BucketOverride | null | undefined;
  try {
    // 覆写查询失败（DB 抖动/10s 缓存过期撞上故障）→ 回落桶默认值。
    // 限流是热路径上的可用性守卫，绝不能因这次查询以 500 击穿请求——
    // 即便驱动链（Redis→PG→内存）本身完全健康。
    const overrides = await getSetting("ratelimit.buckets");
    override = sanitizeOverride(overrides?.[bucket]);
  } catch (err) {
    console.warn(`[rate-limit] bucket override lookup failed, using defaults for ${bucket}:`, err);
  }
  const limit = override?.limit ?? base.limit;
  const windowSec = override?.windowSec ?? base.windowSec;
  await rateLimit(`${bucket}:${identity}`, limit, windowSec * 1000);
}
