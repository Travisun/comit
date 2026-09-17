import { PgBoss } from "pg-boss";

/**
 * Job queue (Laravel queue equivalent) on PostgreSQL via pg-boss — same
 * database, transactional enqueue, retries with backoff.
 *
 * Enqueue from anywhere:  await queue.send("mail.send", {...})
 * Workers are registered once per server process in instrumentation.ts.
 */
export interface JobPayloads {
  "mail.send": {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
  };
  "webhook.deliver": {
    webhookId: string;
    event: string;
    payloadJson: string;
    deliveryId: string;
  };
  "export.cleanup": { requestId: string };
  /** 投票到期：给作者与投票用户派发结果通知（创建时按 endsAt 延迟投递） */
  /** 队列化事件（ShouldQueue 语义，core/capabilities/jobs.ts） */
  "event.dispatch": { name: string; payloadJson: string };
  /** 异步通知（渠道扇出走队列） */
  "notify.dispatch": { userId: string; messageJson: string };
  /** 扩展异步任务（ext.job，按 extensionId.task 路由到注册的处理器） */
  "ext.job": { extensionId: string; task: string; payloadJson: string };
}

type JobName = keyof JobPayloads;

let bossPromise: Promise<PgBoss> | null = null;
/** 上次 start 失败时间（退避冷却用） */
let bossFailedAt = 0;
const BOSS_RETRY_BACKOFF_MS = 5_000;

declare global {
  // TS 声明合并仅允许 var（ambient context，eslint no-var 不适用）
  var __mbBoss: PgBoss | undefined;
}

function createBoss(): PgBoss {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    // pg-boss maintains its own schema migrations
    max: 5,
  });
  boss.on("error", (err: Error) => console.error("[queue]", err));
  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  const cached = globalThis.__mbBoss;
  if (cached) return cached;
  const pending = bossPromise;
  if (pending) return pending;
  // 失败退避：start 失败后清空缓存的 promise（下次调用重新初始化），
  // 冷却期内的调用直接快速失败，避免每次请求都去重连拖垮 DB。
  if (Date.now() - bossFailedAt < BOSS_RETRY_BACKOFF_MS) {
    throw new Error("[queue] pg-boss unavailable (recent start failure, backing off)");
  }
  const p = createBoss()
    .start()
    .then((b) => {
      globalThis.__mbBoss = b;
      return b;
    });
  bossPromise = p;
  // 预挂 catch：start 失败 → 清空缓存 promise 与 __mbBoss，记录冷却起点
  p.catch((err) => {
    console.error("[queue] pg-boss start failed, will retry after backoff:", err);
    bossPromise = null;
    globalThis.__mbBoss = undefined;
    bossFailedAt = Date.now();
  });
  return p;
}

export const queue = {
  async send<K extends JobName>(
    name: K,
    data: JobPayloads[K],
    opts?: { startAfterSeconds?: number; retryLimit?: number; retryDelay?: number },
  ): Promise<string | null> {
    const boss = await getBoss();
    return boss.send(name, data as object, {
      retryLimit: opts?.retryLimit ?? 3,
      retryDelay: opts?.retryDelay ?? 30,
      retryBackoff: true,
      startAfter: opts?.startAfterSeconds,
    });
  },

  /**
   * 注册定时任务（cron，pg-boss 原生调度 — 数据库持久化，多进程不重复触发）。
   * 供 core/capabilities/scheduler 使用；扩展经 PluginContext.cron.register。
   */
  async cron(def: { name: string; cron: string }, handler: () => Promise<void> | void): Promise<void> {
    const boss = await getBoss();
    await boss.createQueue(def.name, { policy: "standard" });
    await boss.schedule(def.name, def.cron);
    await boss.work(def.name, { batchSize: 1 }, async (jobs: unknown) => {
      const list = (Array.isArray(jobs) ? jobs : [jobs]) as { id: string; data: unknown }[];
      for (const job of list) {
        try {
          await handler();
        } catch (err) {
          // 必须rethrow：吞掉错误会让 pg-boss 视为成功 → 失败即丢，重试策略失效
          console.error(`[cron:${def.name}] job ${job.id} tick failed:`, err);
          throw err;
        }
      }
    });
  },

  /** Register a worker (idempotent per process). */
  async work<K extends JobName>(
    name: K,
    handler: (data: JobPayloads[K]) => Promise<void>,
  ): Promise<void> {
    const boss = await getBoss();
    await boss.createQueue(name, { policy: "standard" }); // no-op when it exists
    await boss.work(name, { batchSize: 1 }, async (jobs: unknown) => {
      const list = (Array.isArray(jobs) ? jobs : [jobs]) as { id: string; data: unknown }[];
      for (const job of list) {
        try {
          await handler(job.data as JobPayloads[K]);
        } catch (err) {
          console.error(`[queue:${name}] job ${job.id} failed:`, err);
          throw err; // let pg-boss retry
        }
      }
    });
  },
};
