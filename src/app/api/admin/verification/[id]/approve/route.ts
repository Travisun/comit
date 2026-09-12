import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { approveRequest } from "@/lib/verification.server";
import { assertUuid } from "../../../_shared";
import { afterApproval } from "../../_notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/verification/[id]/approve — approve a pending request. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPermission(req, "admin.verification", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const request = await approveRequest(id, user.id);
    await afterApproval(user.id, request);
    return ok({ ok: true, request });
  });
}
