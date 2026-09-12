import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/invites/[id] — revoke (delete) an invite. Only unused
 * invites can be revoked; used ones are historical records.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.users", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [row] = await db
      .select({ id: invites.id, code: invites.code })
      .from(invites)
      .where(and(eq(invites.id, id), isNull(invites.usedAt)))
      .limit(1);
    if (!row) throw notFound("邀请码不存在或已被使用 / Invite not found or already used");

    await db.delete(invites).where(eq(invites.id, id));
    await logAdmin(user.id, "invite.revoke", "invite", id, `code ${row.code}`);

    return ok({ ok: true });
  });
}
