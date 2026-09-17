import type { ZodType } from "zod";
import { db } from "@/db";
import { modLogs } from "@/db/schema";
import { AppError } from "@/core/errors";

/** Helpers shared by /api/admin/* route handlers. */

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new AppError(`${path}${issue?.message ?? "参数错误 / Invalid input"}`, 400, "bad_request");
  }
  return result.data;
}

/** Parse `limit`/`offset` query params with sane bounds. */
export function pagination(
  url: URL,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const { defaultLimit = 25, maxLimit = 100 } = opts;
  // trunc 拦截浮点数：limit=12.5 会作为 12.5 传给 drizzle limit，PG 在
  // bigint 上下文解析 '12.5' 报 invalid input syntax → 500
  const limit = Math.trunc(
    Math.min(Math.max(Number(url.searchParams.get("limit")) || defaultLimit, 1), maxLimit),
  );
  const offset = Math.trunc(Math.max(Number(url.searchParams.get("offset")) || 0, 0));
  return { limit, offset };
}

/**
 * Optional UUID query-param guard: 空值放行（表示"不过滤"）；非空但格式
 * 不对直接 400 —— 直传 drizzle `eq(x.uuidColumn, 垃圾值)` 会打穿成 PG
 * `22P02 invalid input syntax for type uuid` 的 500。
 */
export function optionalUuid(url: URL, name: string): string | null {
  const v = (url.searchParams.get(name) ?? "").trim();
  if (!v) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new AppError(`${name} 参数格式错误 / Invalid ${name}`, 400, "bad_request");
  }
  return v;
}

/** Mask an email for display: `admin@myblogs.local` → `a***@myblogs.local`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Record an admin action in the mod_logs audit trail. */
export async function logAdmin(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  note?: string | null,
): Promise<void> {
  await db.insert(modLogs).values({
    adminId,
    action,
    targetType,
    targetId,
    note: note ?? null,
  });
}

/** Fetch a route param and ensure it looks like a uuid (defensive). */
export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError("资源不存在 / Not found", 404, "not_found");
  }
  return id;
}
