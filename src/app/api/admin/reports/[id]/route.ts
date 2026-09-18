import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
});

/** POST /api/admin/reports/[id] — resolve or dismiss a report. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const [row] = await db
      .update(reports)
      .set({ status: body.status })
      .where(eq(reports.id, id))
      .returning({ id: reports.id, reporterId: reports.reporterId });
    if (!row) throw notFound("举报不存在 / Report not found");

    await logAdmin(
      user.id,
      body.status === "resolved" ? "report.resolve" : "report.dismiss",
      "report",
      id,
    );
    // 举报人收到处理结果通知（best-effort）
    void emit("report:resolved", {
      reportId: id,
      reporterId: row.reporterId,
      outcome: body.status,
      action: body.status,
    }).catch(() => undefined);
    return ok({ ok: true, status: body.status });
  });
}
