/** Liveness/readiness probe for load balancers and uptime checks. */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      worker: process.env.WORKER_ID ?? "solo",
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
