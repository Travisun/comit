import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { revokeVerification } from "@/lib/verification.server";
import { assertUuid } from "../../../_shared";
import { afterRevoke } from "../../_notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/verification/[id]/revoke — revoke an approved verification
 * (clears users.verified and notifies the user).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPermission(req, "admin.verification", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const request = await revokeVerification(id, user.id);
    await afterRevoke(user.id, request);
    return ok({ ok: true, request });
  });
}
