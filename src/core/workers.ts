import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { queue } from "@/core/queue";
import { sendMail } from "@/lib/mail";
import { asStorageTag, deleteObject } from "@/lib/storage";
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

  // moderation.review / poll.end / export.build 三个任务已自包含到
  // 各扩展（ctx.jobs.work 注册，ext.job 通道统一消费）——见各自 server.ts。
  await queue.work("webhook.deliver", async (data) => {
    const {
      AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
      buildSignatureHeader,
      isPermanentDeliveryError,
      sanitizeDeliveryError,
      signPayload,
    } = await import("@/extensions/webhooks/server");
    const { webhooks } = await import("@/db/schema");
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, data.webhookId)).limit(1);
    if (!hook || !hook.active) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          error: "webhook removed or disabled",
          attempts: sql`${webhookDeliveries.attempts} + 1`,
        })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      return;
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    // 签名覆盖 `timestamp.原始body`；body 用的正是同一串 payloadJson（不再二次序列化）
    const signature = signPayload(hook.secret, data.payloadJson, timestamp);
    // 单次尝试的结果：failure=null 即投递成功。整段只写一次 deliveries / webhooks，
    // 避免"先更新成功状态、再在 catch 里更新失败状态"造成 attempts 累加两次。
    let responseCode: number | null = null;
    let failure: unknown = null;
    try {
      // D5：出站调用统一走 http-client（超时/日志标准化；重试由队列层负责 → retries: 0）。
      // URL 为用户可控 → 开启 SSRF 防护：每跳一次 DNS 解析、逐地址拒绝私网/保留段，
      // 并按已校验 IP pin 直连（连接阶段不再二次解析，rebinding 已闭环）；
      // redirect 手动跟随、每跳重新解析校验；https-only 在 URL 创建/更新时强制。
      const res = await httpRequest(hook.url, {
        method: "POST",
        timeoutMs: 15_000, // 硬超时：黑洞/慢速接收端最多占住 worker 15s（连接+响应整体）
        retries: 0,
        ssrfGuard: true,
        label: "webhook.deliver",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "comit.sh-Webhook/1.0",
          "X-Comit-Timestamp": timestamp,
          // t= 冗余进签名头：接收方只解析一个头也能拿到被签名覆盖的时间戳
          "X-Comit-Signature": buildSignatureHeader(timestamp, signature),
          "X-Comit-Event": data.event,
        },
        body: data.payloadJson,
      });
      responseCode = res.status;
      // 非 2xx 与抛错同等对待：都要重投（接收端 4xx/5xx 视为未送达）
      if (!res.ok) failure = new Error(`delivery HTTP ${String(res.status)}`);
    } catch (err) {
      failure = err;
    }

    const delivered = failure === null;
    // 出口错误统一脱敏 + 截断后才落库（下游错误页/内网解析细节不进运维面）
    const errorText = delivered ? null : sanitizeDeliveryError(failure);
    await db
      .update(webhookDeliveries)
      .set({
        status: delivered ? "success" : "failed",
        ...(responseCode !== null ? { responseCode } : {}),
        ...(errorText !== null ? { error: errorText } : {}),
        attempts: sql`${webhookDeliveries.attempts} + 1`, // 累加而非写死 1：重投次数必须可见
      })
      .where(eq(webhookDeliveries.id, data.deliveryId));
    const failCount = delivered ? 0 : hook.failCount + 1;
    // SSRF/出口策略拦截 = 永久性失败：同一规则下重投必然再被拦，白烧 worker 预算，
    // 且反复解析同一内网目标会形成可被观察到的时序信号 → 停用端点、不再入队。
    const permanent = !delivered && isPermanentDeliveryError(failure);
    await db
      .update(webhooks)
      .set({
        lastStatus: responseCode,
        lastDeliveryAt: new Date(),
        failCount,
        // 自动停用：连续失败封顶后不再为该端点投递。缺这一步，一个永久 5xx 的
        // 端点会随每次平台事件重新入队重试（队列与 webhook_deliveries 双向堆积），
        // failCount 也只是个没有收敛动作的数字。成功一次即清零，故语义是"连续"。
        ...(permanent || failCount >= AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES ? { active: false } : {}),
      })
      .where(eq(webhooks.id, hook.id));
    if (permanent) {
      console.warn(
        `[webhook.deliver] blocked by egress policy, endpoint disabled (webhookId=${String(hook.id)}):`,
        errorText,
      );
      return; // 不 rethrow → 队列不再重试
    }
    if (!delivered) throw failure; // retry via queue
  });

  // 队列化事件（ShouldQueue 语义）
  await queue.work("event.dispatch", async (data) => {
    await dispatchQueuedEvent(data.name, data.payloadJson, data.deliveryKey);
  });

  // 异步通知
  await queue.work("notify.dispatch", async (data) => {
    await runNotifyDispatch(data);
  });

  // 扩展异步任务
  await queue.work("ext.job", async (data) => {
    await runExtJob(data);
  });

  // R2 对象删除补偿（scheduleMediaCleanup 入队）：配置恢复后重删即成功；
  // 仍不可用则 deleteObject 抛 StorageUnavailableError → rethrow 交给
  // pg-boss 按重试策略退避重试，多次失败进 failed 队列（/admin/ops 可见）。
  // 其余错误（对象已不存在等）由 deleteObject 容忍吞掉，视为完成（幂等）。
  await queue.work("storage.delete", async (data) => {
    await deleteObject(data.key, asStorageTag(data.storage));
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
    // one_time_challenges（passkey challenge 一次性键，src/lib/auth/one-time.ts）：
    // 过期未消费的键已不可能有效，清理防表无限增长
    const oneTimePurged = await purgeOneTimeChallenges();
    if (oneTimePurged > 0) {
      console.log(`[cron:maintenance.retention] purged ${oneTimePurged} rows from one_time_challenges`);
    }
    // notification_deliveries（异步投递幂等台账，src/core/delivery-ledger.ts）：
    // 认领键只需覆盖队列重试跨度（分钟级），30 天前的行永远不会再被命中
    const ledgerPurged = await purgeDeliveryLedger();
    if (ledgerPurged > 0) {
      console.log(`[cron:maintenance.retention] purged ${ledgerPurged} rows from notification_deliveries`);
    }
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

/**
 * one_time_challenges 专用清理：主键是 key（无 id 列），批量删除 expires_at
 * 已过期的行（一次性键 TTL 仅分钟级，过期即无效）。幂等。
 */
async function purgeOneTimeChallenges(batchSize = 1000): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await db.execute(
      sql`DELETE FROM one_time_challenges WHERE key IN (
            SELECT key FROM one_time_challenges
            WHERE expires_at < now()
            LIMIT ${batchSize}
          ) RETURNING key`,
    );
    const deleted = res.rows.length;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

/**
 * notification_deliveries 专用清理：主键是 dedupe_key（无 id 列），按 30 天窗口
 * 批量删除。幂等。
 */
async function purgeDeliveryLedger(batchSize = 1000): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await db.execute(
      sql`DELETE FROM notification_deliveries WHERE dedupe_key IN (
            SELECT dedupe_key FROM notification_deliveries
            WHERE created_at < now() - interval '30 days'
            LIMIT ${batchSize}
          ) RETURNING dedupe_key`,
    );
    const deleted = res.rows.length;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
