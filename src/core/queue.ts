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
