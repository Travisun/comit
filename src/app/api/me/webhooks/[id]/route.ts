import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import{notFound, ok, withUser, jsonBody} from "@/lib/http";
import { conflict } from "@/core/errors";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { withAdvisoryLock } from "@/lib/pg-lock";
import { ALL_WEBHOOK_EVENT_NAMES, newWebhookSecret } from "@/extensions/webhooks/server";
import { webhookUrlDedupKey } from "@/extensions/webhooks/url-policy";
import { parseOrThrow, webhookUrlSchema } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

const patchSchema = z.object({
  // 与创建共用同一 URL schema（https-only + 凭据/IP 字面量/内网黑名单），防止把
  // 已创建的合法 webhook 更新成 SSRF 地址绕过创建层防线
  url: webhookUrlSchema.optional(),
  events: z.array(z.enum(ALL_WEBHOOK_EVENT_NAMES)).min(1).max(ALL_WEBHOOK_EVENT_NAMES.length).optional(),
  active: z.boolean().optional(),
});

/**
 * PATCH /api/me/webhooks/[id] — update url / events / active.
 *
 * 换址即换密钥：secret 与该端点一一对应，若把 URL 从 A 改到 B 而沿用旧密钥，
 * 曾控制 A 的一方可继续用旧密钥为投递到 B 的报文签出合法签名（接收方 B 无从分辨）。
 * 新密钥只在响应里回显一次（本站设置页不提供改址入口，故无 UI 破坏面）。
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);
    const body = parseOrThrow(patchSchema, await jsonBody(req).catch(() => null));
    // 改址 = 换一条出站通道，与创建同桶限速（在临界区外计数，避免锁内做可有可无的写）
    if (body.url !== undefined) await rateLimitBucket("webhook.manage", auth.user.id);

    const events = body.events ? [...new Set(body.events)] : undefined;
    // 与创建共用同一把用户级锁：改址的同址去重也是 check-then-write，
    // 两条并发 PATCH（或 PATCH + POST）可把不同行指向同一端点，绕过投递扇出上限
    const rotatedSecret = await withAdvisoryLock(`webhook:${auth.user.id}`, async (tx) => {
      const patch: Partial<typeof webhooks.$inferInsert> = {};
      let secret: string | null = null;
      if (body.url !== undefined) {
        const others = await tx
          .select({ url: webhooks.url })
          .from(webhooks)
          .where(and(eq(webhooks.userId, auth.user.id), ne(webhooks.id, id)));
        const key = webhookUrlDedupKey(body.url);
        if (others.some((w) => webhookUrlDedupKey(w.url) === key)) {
          throw conflict("该端点已注册 / Endpoint already registered");
        }
        patch.url = body.url;
        secret = newWebhookSecret();
        patch.secret = secret;
        patch.failCount = 0; // 新地址新账：旧端点的连续失败不应让新端点一出生就被自动停用逻辑掐掉
      }
      if (events !== undefined) patch.events = events;
      if (body.active !== undefined) {
        patch.active = body.active;
        // 重新启用即给一整轮重试预算：failCount 的语义是"连续失败"，
        // 人工恢复若不归零，下一条投递仍会立刻撞上 AUTO_DISABLE 阈值
        if (body.active) patch.failCount = 0;
      }

      const rows = Object.keys(patch).length
        ? await tx
            .update(webhooks)
            .set(patch)
            .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
            .returning({ id: webhooks.id })
        : await tx
            .select({ id: webhooks.id })
            .from(webhooks)
            .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
            .limit(1);
      if (!rows.length) throw notFound("Webhook 不存在 / Webhook not found");
      return secret;
    });
    return ok(
      rotatedSecret
        ? {
            secret: rotatedSecret,
            message: "签名密钥已随地址变更轮换，仅显示一次 / Secret rotated with the URL, shown once",
          }
        : {},
    );
  });
}

/** DELETE /api/me/webhooks/[id] — remove a webhook (deliveries cascade). */
export async function DELETE(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);

    const rows = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
      .returning({ id: webhooks.id });
    if (!rows.length) throw notFound("Webhook 不存在 / Webhook not found");
    return ok();
  });
}
