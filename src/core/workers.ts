import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { queue } from "@/core/queue";
import { sendMail } from "@/lib/mail";
import { httpRequest } from "@/core/http-client";
import { registerCronTask } from "@/core/capabilities/scheduler";
import {
  dispatchQueuedEvent,
  runExtJob,
  runNotifyDispatch,
} from "@/core/capabilities/jobs";

/**
 * Queue workers — registered once per server process from instrumentation.ts.
 * Each job type has a processor here; failures throw so pg-boss retries with
 * exponential backoff.
 *
 * 依赖方向：core 不在模块顶层 import extensions/*（core → extensions 反向依赖
 * 已修复）—— 扩展的 server 模块在各自 job 处理器内 `await import` 懒加载，
 * 注册行为与顺序不变（对照 extensions/_boot/server.ts 的懒 import 模式）。
 */
export async function startWorkers(): Promise<void> {
  await queue.work("mail.send", async (data) => {
    await sendMail(data);
  });

  await queue.work("moderation.review", async (data) => {
    const { processModerationJob } = await import("@/extensions/moderation/server");
    await processModerationJob(data.postId);
  });

  await queue.work("poll.end", async (data) => {
    const { processPollEnd } = await import("@/extensions/poll/server");
    await processPollEnd(data.postId);
  });

  await queue.work("export.build", async (data) => {
    const { processExportJob } = await import("@/extensions/export/server");
    await processExportJob(data.userId, data.requestId);
  });

  await queue.work("webhook.deliver", async (data) => {
    const { signPayload } = await import("@/extensions/webhooks/server");
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
      // D5：出站调用统一走 http-client（超时/日志标准化；重试由队列层负责 → retries: 0）。
      // URL 为用户可控 → 开启 SSRF 防护（DNS 校验私网/保留地址 + 手动跟随重定向逐跳复检）
      const res = await httpRequest(hook.url, {
        method: "POST",
        timeoutMs: 15_000,
        retries: 0,
        ssrfGuard: true,
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

  // 增长型表保留策略：核心侧 cron 交给 startScheduledTasks 统一注册到 pg-boss
  registerCronTask({ name: "maintenance.retention", cron: "23 3 * * *" }, async () => {
    for (const spec of RETENTION_SPECS) {
      const purged = await purgeExpiredRows(spec);
      if (purged > 0) console.log(`[cron:maintenance.retention] purged ${purged} rows from ${spec.table}`);
    }
    // rate_limits（分布式限流，src/lib/rate-limit.ts）：窗口起点早于 24h 的行
    // 已不可能命中当前窗口（限流窗口最长为分钟级），批量删除防表无限增长
    const ratePurged = await purgeRateLimits();
    if (ratePurged > 0) console.log(`[cron:maintenance.retention] purged ${ratePurged} rows from rate_limits`);
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

/* ============================ 数据保留策略 ============================ */

/** 增长型表保留期限（表/列/天数均为编译期常量，无注入面） */
const RETENTION_SPECS = [
  { table: "sessions", column: "expires_at", days: 7 }, // 过期 7 天后的会话
  { table: "webhook_deliveries", column: "created_at", days: 30 },
  { table: "ext_signature_events", column: "created_at", days: 90 }, // src/extensions/signature/schema.ts
] as const;

/**
 * 按批删除过期行（默认每批 1000 行，循环直至删完），避免长事务/大范围锁。
 * 幂等：删完后再次运行删除 0 行。
 */
async function purgeExpiredRows(
  spec: (typeof RETENTION_SPECS)[number],
  batchSize = 1000,
): Promise<number> {
  const table = sql.identifier(spec.table);
  const column = sql.identifier(spec.column);
  let total = 0;
  for (;;) {
    const res = await db.execute(
      sql`DELETE FROM ${table} WHERE id IN (
            SELECT id FROM ${table}
            WHERE ${column} < now() - interval '${sql.raw(String(spec.days))} days'
            LIMIT ${batchSize}
          ) RETURNING id`,
    );
    const deleted = res.rows.length;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

/**
 * rate_limits 专用清理：主键是 key（无 id 列），按 key IN 子查询批量删除
 * window_start 早于 24h 前的行，风格与 purgeExpiredRows 一致。幂等。
 */
async function purgeRateLimits(batchSize = 1000): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await db.execute(
      sql`DELETE FROM rate_limits WHERE key IN (
            SELECT key FROM rate_limits
            WHERE window_start < now() - interval '24 hours'
            LIMIT ${batchSize}
          ) RETURNING key`,
    );
    const deleted = res.rows.length;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
