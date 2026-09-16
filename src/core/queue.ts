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
  "moderation.review": { postId: string };
  "export.build": { userId: string; requestId: string };
  "export.cleanup": { requestId: string };
  /** 投票到期：给作者与投票用户派发结果通知（创建时按 endsAt 延迟投递） */
  "poll.end": { postId: string };
  /** 队列化事件（ShouldQueue 语义，core/capabilities/jobs.ts） */
  "event.dispatch": { name: string; payloadJson: string };
  /** 异步通知（渠道扇出走队列） */
  "notify.dispatch": { userId: string; messageJson: string };
  /** 扩展异步任务（ext.job，按 extensionId.task 路由到注册的处理器） */
  "ext.job": { extensionId: string; task: string; payloadJson: string };
}

type JobName = keyof JobPayloads;

let bossPromise: Promise<PgBoss> | null = null;

declare global {
  // eslint-disable-next-line no-var
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
  if (!globalThis.__mbBoss) {
    if (!bossPromise) {
      bossPromise = createBoss().start().then((b) => {
        globalThis.__mbBoss = b;
        return b;
      });
    }
    await bossPromise;
  }
  return globalThis.__mbBoss!;
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
          console.error(`[cron:${def.name}] tick failed:`, err);
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
