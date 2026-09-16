import { sql } from "drizzle-orm";
import { db } from "@/db";
import { limiterStatus } from "@/lib/rate-limit";
import { storageStatus } from "@/lib/storage";

/** Liveness/readiness probe for load balancers and uptime checks. */
export const dynamic = "force-dynamic";

const DB_PROBE_TIMEOUT_MS = 2_000;

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

export async function GET() {
  // db 探活与限流器/存储驱动状态并行采集：后两者是纯同步配置判定，不增加时延
  const [dbOk, limiter, storage] = await Promise.all([probeDb(), limiterStatus(), Promise.resolve(storageStatus())]);
  return Response.json(
    {
      ok: dbOk,
      status: dbOk ? "ok" : "degraded",
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
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
