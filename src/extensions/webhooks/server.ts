import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhooks, webhookDeliveries } from "@/db/schema";
import { createHmac, randomBytes } from "crypto";
import { queue } from "@/core/queue";
import type { AppEventPayloads } from "@/core/events";
import {
  type NotificationChannel,
  type NotificationMessage,
  type Plugin,
  type PluginContext,
} from "@/core/plugins/types";

/**
 * Webhook plugin — users subscribe to platform events; deliveries are
 * POSTed as JSON signed with `X-Comit-Signature: t=<ts>,v1=<hmac>`,
 * retried by the queue with exponential backoff.
 */
export const WEBHOOK_EVENTS = [
  "post:published",
  "post:liked",
  "comment:created",
  "user:followed",
  "message:created",
  "moderation:review.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const ALL_WEBHOOK_EVENT_NAMES = [...WEBHOOK_EVENTS, "notification"] as const;

export function signPayload(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** Queue a signed delivery for one webhook. */
async function enqueueDelivery(hook: typeof webhooks.$inferSelect, event: string, payload: Record<string, unknown>) {
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ webhookId: hook.id, event, payload })
    .returning({ id: webhookDeliveries.id });
  // queue.send 返回 null（或抛错）= 队列不可用 → 直接置 failed，避免 delivery 永久 pending
  const jobId = await queue
    .send("webhook.deliver", {
      webhookId: hook.id,
      event,
      payloadJson: JSON.stringify({ event, data: payload, deliveryId: delivery.id }),
      deliveryId: delivery.id,
    })
    .catch((err: unknown) => {
      console.error("[webhooks] queue.send failed:", err);
      return null;
    });
  if (jobId === null) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", error: "queue unavailable: enqueue failed" })
      .where(eq(webhookDeliveries.id, delivery.id));
  }
}

/** Fan a domain event out to every subscribed, active webhook. */
async function dispatchWebhooks<K extends keyof AppEventPayloads>(
  event: K,
  payload: AppEventPayloads[K],
): Promise<void> {
  const hooks = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.active, true),
        sql`${webhooks.events} @> ${JSON.stringify([event])}::jsonb`,
      ),
    );
  for (const hook of hooks) {
    await enqueueDelivery(hook, event as string, payload as unknown as Record<string, unknown>);
  }
}

/** 'webhook' notification channel — notifications become webhook deliveries. */
export const webhookChannel: NotificationChannel = {
  id: "webhook",
  label: { zh: "Webhook", en: "Webhook" },
  async send(userId: string, message: NotificationMessage) {
    const hooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.userId, userId),
          eq(webhooks.active, true),
          sql`${webhooks.events} @> ${JSON.stringify(["notification"])}::jsonb`,
        ),
      );
    for (const hook of hooks) {
      await enqueueDelivery(hook, "notification", message as unknown as Record<string, unknown>);
    }
  },
};

const plugin: Plugin = {
  name: "webhooks",
  description: "User webhook subscriptions with HMAC-signed delivery",
  version: "1.0.0",
  register(ctx: PluginContext) {
    ctx.registerChannel(webhookChannel);
    for (const event of WEBHOOK_EVENTS) {
      ctx.events.on(event, (payload) => {
        void dispatchWebhooks(event, payload);
      });
    }
  },
};

export default plugin;
