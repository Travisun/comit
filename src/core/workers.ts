import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { queue } from "@/core/queue";
import { sendMail } from "@/lib/mail";
import { processModerationJob } from "@/plugins/moderation";
import { processExportJob } from "@/plugins/export";
import { signPayload } from "@/plugins/webhooks";

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
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "comit.sh-Webhook/1.0",
          "X-Comit-Timestamp": timestamp,
          "X-Comit-Signature": `v1=${signature}`,
          "X-Comit-Event": data.event,
        },
        body: data.payloadJson,
        signal: AbortSignal.timeout(15_000),
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

  console.log("[workers] queue workers registered");
}

/** Clean up stale pending deliveries on boot (crash recovery). */
export async function recoverStaleDeliveries(): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "failed", error: "interrupted" })
    .where(and(eq(webhookDeliveries.status, "pending"), isNull(webhookDeliveries.responseCode)));
}
