import { and, eq } from "drizzle-orm";
import { z, type ZodType } from "zod";
import { db } from "@/db";
import { media } from "@/db/schema";
import { AppError } from "@/core/errors";
import { isForbiddenHostLiteral } from "@/core/http-client";

/** Helpers shared by /api/me/* route handlers. */

/** webhook URL schema — 创建与更新共用同一内网/本机字面量黑名单（SSRF 防线一；
 * DNS 级权威校验在投递时 ssrfGuard，见 core/http-client）。 */
export const webhookUrlSchema = z
  .url("URL 格式不正确 / Invalid URL")
  .max(2000)
  .startsWith("http")
  .refine((u) => !isForbiddenHostLiteral(new URL(u).hostname), {
    message: "URL 不允许指向本机或内网地址 / URL must not point to internal hosts",
  });

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new AppError(`${path}${issue?.message ?? "参数错误 / Invalid input"}`, 400, "bad_request");
  }
  return result.data;
}

/** Mask an email for display: `john.doe@example.com` → `j***@gmail.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Empty string → null; used for optional profile URL fields. */
export function emptyToNull(v: string | undefined | null): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/** Ensure the given media path belongs to the user (avatar/cover assignment). */
export async function assertOwnMedia(userId: string, path: string): Promise<void> {
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.path, path)))
    .limit(1);
  if (!row) {
    throw new AppError("媒体文件不存在或不属于你 / Media not found", 400, "bad_media");
  }
}

export const localeSchema = z.enum(["zh", "en"]);
