import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { notFound, ok, withUser } from "@/lib/http";
import { ALL_WEBHOOK_EVENT_NAMES } from "@/extensions/webhooks/server";
import { parseOrThrow, webhookUrlSchema } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

const patchSchema = z.object({
  // 与创建共用同一 URL schema（内网/本机黑名单），防止把已创建的合法
  // webhook 更新成 SSRF 地址绕过创建层防线
  url: webhookUrlSchema.optional(),
  events: z.array(z.enum(ALL_WEBHOOK_EVENT_NAMES)).min(1).optional(),
  active: z.boolean().optional(),
});

/** PATCH /api/me/webhooks/[id] — update url / events / active. */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);
    const body = parseOrThrow(patchSchema, await req.json().catch(() => null));

    const patch: Partial<typeof webhooks.$inferInsert> = {};
    if (body.url !== undefined) patch.url = body.url;
    if (body.events !== undefined) patch.events = [...body.events];
    if (body.active !== undefined) patch.active = body.active;

    const rows = await db
      .update(webhooks)
      .set(patch)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
      .returning({ id: webhooks.id });
    if (!rows.length) throw notFound("Webhook 不存在 / Webhook not found");
    return ok();
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
