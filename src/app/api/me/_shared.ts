import { and, eq } from "drizzle-orm";
import { z, type ZodType } from "zod";
import { db } from "@/db";
import { media } from "@/db/schema";
import { AppError } from "@/core/errors";
import { assertWebhookUrl, WEBHOOK_URL_MAX_LENGTH } from "@/extensions/webhooks/url-policy";

/** Helpers shared by /api/me/* route handlers. */

/** webhook URL schema — 创建与更新共用同一份，防止 PATCH 把已创建的合法端点改成
 * SSRF 地址绕过创建层防线。规则实现收口在 extensions/webhooks/url-policy（纯函数、
 * 可单测）：仅 https（明文 http 会泄露签名头与 payload；仅 WEBHOOK_ALLOW_HTTP=1 的
 * 本地联调场景放行）+ 拒内嵌凭据 + 拒 IP 字面量及其十进制/八进制/十六进制变体 +
 * 本机/内网字面量黑名单（SSRF 防线一）。transform 返回**归一化 href** → 落库值与
 * 校验解析结果严格同源。权威校验在投递时 ssrfGuard：DNS 解析逐地址拒绝私网/保留段
 * 并按已校验 IP pin 连接（rebinding 已闭环，见 core/http-client）。 */
export const webhookUrlSchema = z
  .string()
  .max(WEBHOOK_URL_MAX_LENGTH, `URL 过长 / URL too long（≤${WEBHOOK_URL_MAX_LENGTH}）`)
  .transform((u, ctx) => {
    try {
      return assertWebhookUrl(u);
    } catch (err) {
      ctx.addIssue({ code: "custom", message: err instanceof Error ? err.message : "URL 格式不正确 / Invalid URL" });
      return z.NEVER;
    }
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

/** Mask an email for display: `john.doe@example.com` → `j***@example.com`. */
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
