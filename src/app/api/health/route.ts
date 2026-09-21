import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Liveness/readiness probe for load balancers and uptime checks.
 *
 * 公开发布前的收敛：本端点无鉴权（LB/宝塔/uptime 必须能直接探），因此响应
 * 缩减为最小 `{ status }` —— 版本号、worker/pid/uptime、DB/Redis/队列细节
 * 一律不外泄（这些信息可被用于指纹识别与攻击面枚举）。完整快照见
 * `GET /api/admin/health`（admin.ops 权限）。
 */
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
  const dbOk = await probeDb();
  // 仅 ok/degraded 两态；HTTP 200/503 供探活（LB 按状态码摘除流量）
  return Response.json(
    { status: dbOk ? "ok" : "degraded" },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
