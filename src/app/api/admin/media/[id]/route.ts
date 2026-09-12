import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";
import { deleteMediaFile } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/media/[id] — remove a media row, its file on disk and
 * leave an audit trail (media.delete).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.media", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [row] = await db
      .select({
        id: media.id,
        path: media.path,
        filename: media.filename,
        userId: media.userId,
      })
      .from(media)
      .where(eq(media.id, id))
      .limit(1);
    if (!row) throw notFound("媒体不存在 / Media not found");

    await db.delete(media).where(eq(media.id, id));
    await deleteMediaFile(row.path);
    await logAdmin(user.id, "media.delete", "media", id, `${row.filename} (owner ${row.userId})`);

    return ok({ ok: true });
  });
}
