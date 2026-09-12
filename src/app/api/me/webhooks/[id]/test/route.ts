import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { notFound, ok, withUser } from "@/lib/http";
import { queue } from "@/core/queue";
import { parseOrThrow } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/**
 * POST /api/me/webhooks/[id]/test — queue a signed `ping` test delivery
 * (recorded in webhook_deliveries like any other event).
 */
export async function POST(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);

    const [hook] = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
      .limit(1);
    if (!hook) throw notFound("Webhook 不存在 / Webhook not found");

    const deliveryId = randomUUID();
    const payload = { event: "ping", data: { message: "webhook test" }, deliveryId };
    await db.insert(webhookDeliveries).values({
      webhookId: hook.id,
      event: "notification",
      payload,
      status: "pending",
    });
    await queue.send("webhook.deliver", {
      webhookId: hook.id,
      event: "notification",
      payloadJson: JSON.stringify(payload),
      deliveryId,
    });

    return ok({ deliveryId });
  });
}
