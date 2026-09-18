import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { exportJobs } from "@/db/schema";
import { unauthorized } from "@/core/errors";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { queue } from "@/core/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export — this user's export jobs, newest first. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();

    const rows = await db
      .select({
        id: exportJobs.id,
        status: exportJobs.status,
        sizeBytes: exportJobs.sizeBytes,
        error: exportJobs.error,
        createdAt: exportJobs.createdAt,
        finishedAt: exportJobs.finishedAt,
      })
      .from(exportJobs)
      .where(eq(exportJobs.userId, user.id))
      .orderBy(desc(exportJobs.createdAt))
      .limit(20);
    return ok({ jobs: rows });
  });
}

/**
 * POST /api/export — enqueue a fresh export build; the worker zips every
 * post + media into storage/exports/{requestId}.zip and flips the job to done.
 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    // 全量 zip 构建是 CPU/磁盘密集任务（worker 并发有限），按用户限流防单
    // 人循环入队占满队列
    await rateLimitBucket("export.create", auth.user.id);
    const [job] = await db
      .insert(exportJobs)
      .values({ userId: auth.user.id, status: "queued" })
      .returning({ id: exportJobs.id });
    try {
      await queue.send(
        "ext.job",
        { extensionId: "export", task: "build", payloadJson: JSON.stringify({ userId: auth.user.id, requestId: job.id }) },
      );
    } catch (err) {
      await db
        .update(exportJobs)
        .set({ status: "failed", error: String(err) })
        .where(eq(exportJobs.id, job.id));
      throw err;
    }
    return ok({ requestId: job.id });
  });
}
