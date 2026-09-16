import { sql } from "drizzle-orm";
import { db } from "@/db";

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
  const dbOk = await probeDb();
  return Response.json(
    {
      ok: dbOk,
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      worker: process.env.WORKER_ID ?? "solo",
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
