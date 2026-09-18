import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { pagination } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["draft", "pending_review", "published", "rejected", "deleted"] as const;

/** GET /api/admin/posts?status=&q=&limit=25&offset= — searchable post list. */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const { limit, offset } = pagination(url);
    const status = url.searchParams.get("status") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim();

    const filters: SQL[] = [];
    if ((STATUSES as readonly string[]).includes(status)) {
      filters.push(eq(posts.status, status as (typeof STATUSES)[number]));
    }
    if (q) {
      const like = `%${q}%`;
      const cond = or(
        ilike(posts.title, like),
        ilike(users.username, like),
        ilike(users.displayName, like),
      );
      if (cond) filters.push(cond);
    }
    const where = filters.length ? and(...filters) : undefined;

    const [items, [{ n: total }]] = await Promise.all([
      db
        .select({
          id: posts.id,
          title: posts.title,
          type: posts.type,
          status: posts.status,
          views: posts.views,
          likeCount: posts.likeCount,
          commentCount: posts.commentCount,
          publishedAt: posts.publishedAt,
          createdAt: posts.createdAt,
          rejectReason: posts.rejectReason,
          author: { username: users.username, displayName: users.displayName },
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(where)
        .orderBy(desc(posts.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ n: count() })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(where),
    ]);

    return ok({ items, total });
  });
}
