import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, users } from "@/db/schema";
import { ok } from "@/lib/http"
import { mentionTokensToPlainText } from "@/lib/mentions";
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
          postPublicId: posts.publicId,
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
      // 预览为纯文本直出：mention 语法先拉平成 @昵称（带最新昵称）再截断，
      // 否则表格漏链接语法、截点还可能落在语法中间
      items: await Promise.all(
        items.map(async (c) => ({ ...c, body: truncate(await mentionTokensToPlainText(c.body), 100) })),
      ),
      total,
    });
  });
}
