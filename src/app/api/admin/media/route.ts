import { and, count, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { media, users } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { optionalUuid, pagination } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/media?userId=&kind=inline|avatar|cover|featured&q=&limit=30&offset=
 * Site-wide media browser. Returns a filtered page of items (with owner info)
 * plus global stats: total files, total bytes and uploads this month.
 */
export async function GET(req: Request) {
  return withPermission(req, "admin.media", async () => {
    const url = new URL(req.url);
    const { limit, offset } = pagination(url);
    // 非法 UUID 直接 400，避免垃圾值打穿 drizzle eq(uuid) 变 PG 500
    const userId = optionalUuid(url, "userId") ?? "";
    const kind = (url.searchParams.get("kind") ?? "").trim();
    const q = (url.searchParams.get("q") ?? "").trim();

    const conds: SQL[] = [];
    if (userId) conds.push(eq(media.userId, userId));
    if (kind === "inline" || kind === "avatar" || kind === "cover" || kind === "featured") {
      conds.push(eq(media.kind, kind));
    }
    if (q) {
      const like = `%${q}%`;
      // search by filename or owner username
      conds.push(sql`(${media.filename} ilike ${like} or ${users.username} ilike ${like})`);
    }
    const where = conds.length ? and(...conds) : undefined;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const sizeSum = sql<number>`coalesce(sum(${media.size}), 0)`.mapWith(Number);

    const [rows, [{ n: total }], [globalStats], [monthStats]] = await Promise.all([
      db
        .select({
          id: media.id,
          userId: media.userId,
          path: media.path,
          filename: media.filename,
          mime: media.mime,
          size: media.size,
          width: media.width,
          height: media.height,
          kind: media.kind,
          alt: media.alt,
          createdAt: media.createdAt,
          ownerUsername: users.username,
          ownerDisplayName: users.displayName,
          ownerAvatar: users.avatarPath,
        })
        .from(media)
        .innerJoin(users, eq(users.id, media.userId))
        .where(where)
        .orderBy(desc(media.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(media).where(where),
      db.select({ files: count(), bytes: sizeSum }).from(media),
      db
        .select({ files: count() })
        .from(media)
        .where(gte(media.createdAt, monthStart)),
    ]);

    return ok({
      items: rows,
      total,
      stats: {
        files: globalStats.files,
        bytes: globalStats.bytes,
        monthFiles: monthStats.files,
      },
    });
  });
}
