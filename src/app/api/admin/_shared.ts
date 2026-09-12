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
export function pagination(url: URL): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  return { limit, offset };
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
