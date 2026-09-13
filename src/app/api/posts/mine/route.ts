import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { withUser, ok } from "@/lib/http";

/**
 * GET /api/posts/mine?status=&type=&q=&limit=&offset=
 * The author's own posts across every lifecycle state — powers the
 * dashboard "我的文章" management table.
 */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "all";
    const type = url.searchParams.get("type") ?? "all";
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 200);
    const offset = Number(url.searchParams.get("offset") ?? 0);

    const conds = [eq(posts.authorId, auth.user.id)];
    if (status !== "all") conds.push(eq(posts.status, status as never));
    if (type !== "all") conds.push(eq(posts.type, type as never));
    if (q) {
    const like = `%${q}%`;
    conds.push(or(ilike(posts.title, like), ilike(posts.content, like))!);
  }

    const where = and(...conds);
    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          id: posts.id,
          type: posts.type,
          collectionId: posts.collectionId,
          title: posts.title,
          slug: posts.slug,
          summary: posts.summary,
          label: posts.label,
          status: posts.status,
          visibility: posts.visibility,
          views: posts.views,
          likeCount: posts.likeCount,
          commentCount: posts.commentCount,
          rejectReason: posts.rejectReason,
          publishedAt: posts.publishedAt,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(where)
        .orderBy(desc(posts.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(posts).where(where),
    ]);
    return ok({ items, total, nextOffset: offset + items.length < total ? offset + limit : null });
  });
}

