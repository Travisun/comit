import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { notFound } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { deleteMediaFile } from "@/lib/media";
import { asStorageTag } from "@/lib/storage";
import { routes } from "@/core/routes";
import { parseWith } from "@/app/api/posts/_shared";

/**
 * GET /api/media?limit=50&offset=0 — the current user's media library, newest
 * first → { items, nextOffset } (nextOffset null when no more pages).
 */
export async function GET(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

    const items = await db
      .select()
      .from(media)
      .where(eq(media.userId, auth.user.id))
      .orderBy(desc(media.createdAt))
      .limit(limit)
      .offset(offset);

    return ok({
      items: items.map((m) => ({ ...m, url: routes.media(m.path) })),
      nextOffset: items.length === limit ? offset + limit : null,
    });
  });
}

/**
 * DELETE /api/media?id=<uuid> — remove one of the user's media: DB row + file.
 */
export async function DELETE(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const id = parseWith(z.uuid(), new URL(req.url).searchParams.get("id") ?? "");
    const [row] = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, auth.user.id)))
      .limit(1);
    if (!row) throw notFound("媒体不存在 / Media not found");

    await db.delete(media).where(eq(media.id, id));
    // 按行自己的驱动删文件（混存兼容：存量 local 行、新 r2 行各归各位）；
    // R2 配置不可用时 deleteMediaFile 内部转 storage.delete 队列补偿
    await deleteMediaFile(row.path, asStorageTag(row.storage));
    return ok({ id });
  });
}
