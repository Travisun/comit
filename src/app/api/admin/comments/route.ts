import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, users } from "@/db/schema";
import { withAdmin, ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { truncate } from "@/lib/utils";
import { pagination } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/comments?limit=25&offset= — latest comments across all posts. */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const { limit, offset } = pagination(url);

    const [items, [{ n: total }]] = await Promise.all([
      db
        .select({
          id: comments.id,
          body: comments.body,
          status: comments.status,
          postId: comments.postId,
          postTitle: posts.title,
          createdAt: comments.createdAt,
          author: { username: users.username, displayName: users.displayName },
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.userId))
        .innerJoin(posts, eq(posts.id, comments.postId))
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(comments),
    ]);

    return ok({
      items: items.map((c) => ({ ...c, body: truncate(c.body, 100) })),
      total,
    });
  });
}
