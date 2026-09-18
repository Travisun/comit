import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { unauthorized } from "@/core/errors";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { ALL_WEBHOOK_EVENT_NAMES, newWebhookSecret } from "@/extensions/webhooks/server";
import { parseOrThrow, webhookUrlSchema } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/webhooks — list own webhooks (secret reduced to an 8-char prefix). */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, user.id))
      .orderBy(desc(webhooks.createdAt));

    return ok({
      webhooks: rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        lastStatus: w.lastStatus,
        lastDeliveryAt: w.lastDeliveryAt,
        failCount: w.failCount,
        secretPrefix: w.secret.slice(0, 8),
        createdAt: w.createdAt,
      })),
      availableEvents: ALL_WEBHOOK_EVENT_NAMES,
    });
  });
}

const postSchema = z.object({
  // webhookUrlSchema：拦截本机/内网字面量（与 PATCH 更新接口共用，见 me/_shared）
  url: webhookUrlSchema,
  events: z.array(z.enum(ALL_WEBHOOK_EVENT_NAMES)).min(1, "至少选择一个事件 / Pick at least one event"),
});

/** POST /api/me/webhooks — create a webhook; the signing secret is returned once. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(postSchema, await req.json().catch(() => null));
    const secret = newWebhookSecret();
    const [row] = await db
      .insert(webhooks)
      .values({
        userId: auth.user.id,
        url: body.url,
        secret,
        events: [...body.events],
        active: true,
      })
      .returning({ id: webhooks.id });

    return ok({ webhook: { id: row.id, secret }, message: "签名密钥仅显示一次 / Secret shown once" });
  });
}
