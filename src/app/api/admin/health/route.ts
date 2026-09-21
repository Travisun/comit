import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { limiterStatus } from "@/lib/rate-limit";
import { storageStatus } from "@/lib/storage";

/**
 * GET /api/admin/health — 完整健康快照（admin.ops 鉴权）。
 *
 * 公开探针 `/api/health` 已收敛为最小 `{ status }`（见该路由注释），原先公
 * 开的细节全部迁移至此：版本号、worker/pid/uptime、DB/Redis（限流器驱
 * 动）/存储驱动状态。队列深度另见 `/api/admin/ops`。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_PROBE_TIMEOUT_MS = 2_000;
const APP_VERSION = process.env.APP_VERSION ?? "dev";

/** DB 探活（readiness）：select 1 + 2s 超时，失败降级 degraded。 */
async function probeDb(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db probe timeout")), DB_PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  return withPermission(req, "admin.ops", async () => {
    // db 探活与限流器/存储驱动状态并行采集：后两者是纯同步配置判定，不增加时延
    const [dbOk, limiter, storage] = await Promise.all([
      probeDb(),
      limiterStatus(),
      Promise.resolve(storageStatus()),
    ]);
    return ok({
      ok: dbOk,
      status: dbOk ? "ok" : "degraded",
      version: APP_VERSION,
      db: dbOk,
      worker: process.env.WORKER_ID ?? "solo",
      // 限流器驱动链：{ driver: "redis" | "pg" | "memory", redisConfigured }，
      // driver 为下一次调用将使用的驱动（静态判定，运行时故障降级见限频日志）
      limiter,
      // 存储驱动链：{ driver: "local" | "r2", r2Configured }，driver 为当前写入
      // 驱动（STORAGE_DRIVER=r2 配置缺失时已回落 local），r2Configured 仅表
      // 示 R2 必填 env 是否齐全
      storage,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    });
  });
}
