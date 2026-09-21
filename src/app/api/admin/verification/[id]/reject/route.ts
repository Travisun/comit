import { z } from "zod";
import { ok, jsonBody } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { assertReviewerNotApplicant, rejectRequest } from "@/lib/verification.server";
import { assertUuid, parseOrThrow } from "../../../_shared";
import { afterRejection } from "../../_notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().min(1, "请填写驳回原因 / Reason required").max(300),
});

/** POST /api/admin/verification/[id]/reject — reject a pending request with a reason. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPermission(req, "admin.verification", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));
    await assertReviewerNotApplicant(id, user);
    const request = await rejectRequest(id, user.id, body.reason);
    await afterRejection(user.id, request);
    return ok({ ok: true, request });
  });
}
