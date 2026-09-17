import { and, eq, inArray, sql } from "drizzle-orm";
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
 *
 * ⚠️ 投递作用域（隐私边界）：白名单里的每个事件必须有明确的作用域语义 ——
 * 全局扇出只能投递"公开语义"事件；涉及私密数据的事件走 PARTICIPANT_SCOPED
 * （仅投递给事件当事人自己的 webhook），内部字段走 STRIP_FIELDS 剥离。
 * 新事件入白名单前先回答"这个事件的 payload 可以被任意订阅者看到吗"。
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

/**
 * 参与者作用域：返回值非空时，仅投递给 userId ∈ 返回值的 webhook。
 * message:created 的 payload 含私信全文 —— 无作用域时任意订阅者会持续
 * 收到全平台所有会话的私信内容（2026-09 审计 P0）。
 */
export const PARTICIPANT_SCOPED_EVENTS: Record<string, (p: Record<string, unknown>) => string[]> = {
  "message:created": (p) =>
    [p.senderId, p.receiverId].filter((v): v is string => typeof v === "string"),
};

/** 事件出站前剥离的内部字段（审核理由只应经作者通道/后台可见）。 */
export const STRIPPED_PAYLOAD_FIELDS: Record<string, string[]> = {
  "moderation:review.completed": ["reason"],
};

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

/** Fan a domain event out to every subscribed, active webhook（含作用域策略，见文件头）。 */
async function dispatchWebhooks<K extends keyof AppEventPayloads>(
  event: K,
  payload: AppEventPayloads[K],
): Promise<void> {
  const raw = payload as unknown as Record<string, unknown>;
  // 内部字段剥离：浅拷贝后删除，绝不改动原 payload（其它监听器共享同一对象）
  const strip = STRIPPED_PAYLOAD_FIELDS[event as string];
  const outbound = strip?.length ? { ...raw } : raw;
  if (strip?.length) for (const f of strip) delete outbound[f];
  // 参与者作用域：仅当事人自己的 webhook 收到
  const participants = PARTICIPANT_SCOPED_EVENTS[event as string]?.(raw);

  const conditions = [
    eq(webhooks.active, true),
    sql`${webhooks.events} @> ${JSON.stringify([event])}::jsonb`,
  ];
  if (participants) {
    if (participants.length === 0) return; // 无当事人（防御）→ 无人应收到
    conditions.push(inArray(webhooks.userId, participants));
  }
  const hooks = await db
    .select()
    .from(webhooks)
    .where(and(...conditions));
  for (const hook of hooks) {
    await enqueueDelivery(hook, event as string, outbound);
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
