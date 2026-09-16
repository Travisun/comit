import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { queue } from "@/core/queue";
import { sendMail } from "@/lib/mail";
import { processModerationJob } from "@/extensions/moderation/server";
import { processExportJob } from "@/extensions/export/server";
import { httpRequest } from "@/core/http-client";
import { processPollEnd } from "@/extensions/poll/server";
import {
  dispatchQueuedEvent,
  runExtJob,
  runNotifyDispatch,
} from "@/core/capabilities/jobs";
import { signPayload } from "@/extensions/webhooks/server";

/**
 * Queue workers — registered once per server process from instrumentation.ts.
 * Each job type has a processor here; failures throw so pg-boss retries with
 * exponential backoff.
 */
export async function startWorkers(): Promise<void> {
  await queue.work("mail.send", async (data) => {
    await sendMail(data);
  });

  await queue.work("moderation.review", async (data) => {
    await processModerationJob(data.postId);
  });

  await queue.work("poll.end", async (data) => {
    await processPollEnd(data.postId);
  });

  await queue.work("export.build", async (data) => {
    await processExportJob(data.userId, data.requestId);
  });

  await queue.work("webhook.deliver", async (data) => {
    const { webhooks } = await import("@/db/schema");
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, data.webhookId)).limit(1);
    if (!hook || !hook.active) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", error: "webhook removed or disabled" })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      return;
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(hook.secret, data.payloadJson, timestamp);
    try {
      // D5：出站调用统一走 http-client（超时/日志标准化；重试由队列层负责 → retries: 0）
      const res = await httpRequest(hook.url, {
        method: "POST",
        timeoutMs: 15_000,
        retries: 0,
        label: "webhook.deliver",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "comit.sh-Webhook/1.0",
          "X-Comit-Timestamp": timestamp,
          "X-Comit-Signature": `v1=${signature}`,
          "X-Comit-Event": data.event,
        },
        body: data.payloadJson,
      });
      await db
        .update(webhookDeliveries)
        .set({ status: res.ok ? "success" : "failed", responseCode: res.status, attempts: 1 })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      await db
        .update(webhooks)
        .set({ lastStatus: res.status, lastDeliveryAt: new Date(), failCount: res.ok ? 0 : hook.failCount + 1 })
        .where(eq(webhooks.id, hook.id));
      if (!res.ok) throw new Error(`delivery HTTP ${res.status}`);
    } catch (err) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", error: String(err), attempts: 1 })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      throw err; // retry via queue
    }
  });

  // 队列化事件（ShouldQueue 语义）
  await queue.work("event.dispatch", async (data) => {
    await dispatchQueuedEvent(data.name, data.payloadJson);
  });

  // 异步通知
  await queue.work("notify.dispatch", async (data) => {
    await runNotifyDispatch(data);
  });

  // 扩展异步任务
  await queue.work("ext.job", async (data) => {
    await runExtJob(data);
  });

  console.log("[workers] queue workers registered");

  // 扩展定时任务（bootPlugins 已先于 startWorkers 执行，注册表已就绪）
  const { startScheduledTasks } = await import("@/core/capabilities/scheduler");
  await startScheduledTasks();
}

/** Clean up stale pending deliveries on boot (crash recovery). */
export async function recoverStaleDeliveries(): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "failed", error: "interrupted" })
    .where(and(eq(webhookDeliveries.status, "pending"), isNull(webhookDeliveries.responseCode)));
}
