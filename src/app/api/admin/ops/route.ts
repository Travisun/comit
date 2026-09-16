import { readdir, stat } from "fs/promises";
import type { Dirent } from "node:fs";
import path from "path";
import { count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  comments,
  exportJobs,
  media,
  notifications,
  posts,
  reports,
  users,
  webhookDeliveries,
} from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { pendingReviewCount } from "@/lib/moderation";
import { STORAGE_ROOT } from "@/lib/media";
import { activeStorage, storageStatus } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ops — read-only operations snapshot for the /admin/ops panel.
 *
 * Groups: process (this worker), database (core table row counts), queue
 * (pgboss.job depth by queue × state), content health and on-disk storage
 * usage. Strictly read-only: no inserts/updates, no queue side effects.
 * The storage walk is budgeted (~2s) so a huge media tree can never hang
 * the response — partial results are flagged with `complete: false`.
 * storage 响应形状：{ driver, r2Configured, media, exports, budgetMs[, r2] } —
 * local 部分照旧磁盘遍历；driver=r2 时追加 `r2: { bytes, files }`
 * （SUM(media.size) WHERE storage='r2' 聚合，避免 ListObjects 计费 API）。
 */

const STORAGE_BUDGET_MS = 2_000;

interface DirUsage {
  bytes: number;
  files: number;
  complete: boolean;
}

/** Recursive directory size with a shared wall-clock deadline. */
async function dirUsage(dir: string, deadline: number): Promise<DirUsage> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0, complete: true }; // missing dir ⇒ zero, not an error
  }
  let bytes = 0;
  let files = 0;
  let complete = true;
  for (const entry of entries) {
    if (Date.now() > deadline) {
      complete = false;
      break;
    }
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirUsage(p, deadline);
      bytes += sub.bytes;
      files += sub.files;
      complete = complete && sub.complete;
    } else if (entry.isFile()) {
      try {
        bytes += (await stat(p)).size;
        files += 1;
      } catch {
        /* vanished mid-walk — ignore */
      }
    }
  }
  return { bytes, files, complete };
}

async function storageUsage(root: string, deadline: number): Promise<DirUsage> {
  // Sum top-level entries (media shards by user-id prefix) so the walk stays
  // shallow and cooperative: each top-level dir gets the shared deadline.
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0, complete: true };
  }
  let bytes = 0;
  let files = 0;
  let complete = true;
  for (const entry of entries) {
    if (Date.now() > deadline) {
      complete = false;
      break;
    }
    const p = path.join(root, entry.name);
    if (entry.isFile()) {
      // top-level files (e.g. storage/exports/*.zip) count directly
      try {
        bytes += (await stat(p)).size;
        files += 1;
      } catch {
        /* vanished mid-walk — ignore */
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    const usage = await dirUsage(p, deadline);
    bytes += usage.bytes;
    files += usage.files;
    complete = complete && usage.complete;
  }
  return { bytes, files, complete };
}

interface QueueStateRow {
  queue: string;
  state: string;
  n: number;
}

/** GET handler — everything below is read-only and runs concurrently. */
export async function GET(req: Request) {
  return withPermission(req, "admin.ops", async () => {
    const startedAt = Date.now();
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const driver = activeStorage();
    const { r2Configured } = storageStatus();

    const [
      processInfo,
      tableCounts,
      queueRes,
      queue24hRes,
      pendingReview,
      openReports,
      newUsers24hRes,
      newPosts24hRes,
      mediaUsage,
      exportsUsage,
      r2UsageRows,
    ] = await Promise.all([
      Promise.resolve({
        worker: process.env.WORKER_ID ?? "solo",
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        nodeVersion: process.version,
      }),
      Promise.all([
        db.select({ n: count() }).from(users),
        db.select({ n: count() }).from(posts),
        db.select({ n: count() }).from(comments).where(eq(comments.status, "visible")),
        db.select({ n: count() }).from(media),
        db.select({ n: count() }).from(notifications),
        db.select({ n: count() }).from(webhookDeliveries),
        db.select({ n: count() }).from(reports),
        db.select({ n: count() }).from(exportJobs),
      ]),
      // pgboss.job is a partitioned table keyed by `name` (queue) — states are
      // enum pgboss.job_state: created|retry|active|completed|cancelled|failed.
      db
        .execute<{ queue: string; state: string; n: number }>(
          sql`select name as queue, state::text as state, count(*)::int as n from pgboss.job group by 1, 2`,
        )
        .catch(() => ({ rows: [] as QueueStateRow[] })),
      db
        .execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job where created_on > now() - interval '24 hours'`,
        )
        .catch(() => ({ rows: [{ n: 0 }] })),
      pendingReviewCount(),
      db.select({ n: count() }).from(reports).where(eq(reports.status, "open")),
      db.select({ n: count() }).from(users).where(gte(users.createdAt, since24h)),
      db.select({ n: count() }).from(posts).where(gte(posts.createdAt, since24h)),
      storageUsage(STORAGE_ROOT, Date.now() + STORAGE_BUDGET_MS),
      storageUsage(path.join(process.cwd(), "storage", "exports"), Date.now() + STORAGE_BUDGET_MS),
      // r2 用量走 DB 聚合（行级 size 求和），绝不调 ListObjects 计费 API
      driver === "r2"
        ? db
            .select({
              bytes: sql<string>`coalesce(sum(${media.size}), 0)::bigint`,
              n: count(),
            })
            .from(media)
            .where(eq(media.storage, "r2"))
        : Promise.resolve([{ bytes: "0", n: 0 }]),
    ]);

    const [
      [usersN],
      [postsN],
      [commentsN],
      [mediaN],
      [notificationsN],
      [webhookDeliveriesN],
      [reportsN],
      [exportJobsN],
    ] = tableCounts;
    const [openReportsN] = openReports;
    const [newUsers24h] = newUsers24hRes;
    const [newPosts24h] = newPosts24hRes;
    // ::bigint 经 pg 驱动返回字符串，防 >2GB 溢出；转 number 输出
    const r2Usage =
      driver === "r2"
        ? { bytes: Number(r2UsageRows[0]?.bytes ?? 0), files: r2UsageRows[0]?.n ?? 0 }
        : undefined;

    return ok({
      process: processInfo,
      db: {
        users: usersN.n,
        posts: postsN.n,
        comments: commentsN.n,
        media: mediaN.n,
        notifications: notificationsN.n,
        webhookDeliveries: webhookDeliveriesN.n,
        reports: reportsN.n,
        exportJobs: exportJobsN.n,
      },
      queue: {
        byState: queueRes.rows,
        createdLast24h: queue24hRes.rows[0]?.n ?? 0,
        statesHint: ["created", "retry", "active", "completed", "cancelled", "failed"],
      },
      content: {
        pendingReview,
        openReports: openReportsN.n,
        newUsers24h: newUsers24h.n,
        newPosts24h: newPosts24h.n,
      },
      storage: {
        driver,
        r2Configured,
        // media/exports 为本地磁盘遍历（存量 local 行 + exports zip 仍在盘上）
        media: mediaUsage,
        exports: exportsUsage,
        ...(r2Usage ? { r2: r2Usage } : {}),
        budgetMs: STORAGE_BUDGET_MS,
      },
      collectedInMs: Date.now() - startedAt,
    });
  });
}
