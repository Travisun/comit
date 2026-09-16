import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";
import { deleteMediaFile } from "@/lib/media";
import { asStorageTag } from "@/lib/storage";

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
        storage: media.storage,
        filename: media.filename,
        userId: media.userId,
      })
      .from(media)
      .where(eq(media.id, id))
      .limit(1);
    if (!row) throw notFound("媒体不存在 / Media not found");

    await db.delete(media).where(eq(media.id, id));
    // 按行自己的驱动删文件（混存兼容：存量 local 行、新 r2 行各归各位）；
    // R2 配置不可用时 deleteMediaFile 内部转 storage.delete 队列补偿
    await deleteMediaFile(row.path, asStorageTag(row.storage));
    await logAdmin(user.id, "media.delete", "media", id, `${row.filename} (owner ${row.userId})`);

    return ok({ ok: true });
  });
}
