import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { posts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ postId: z.string().uuid() });

/** POST /api/bookmarks — toggle bookmarking a post. → { bookmarked } */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, parsed.data.postId))
      .limit(1);
    if (!post) throw new AppError("内容不存在 / Post not found", 404, "not_found");

    const removed = await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, auth.user.id), eq(bookmarks.postId, post.id)))
      .returning({ id: bookmarks.id });

    if (removed.length > 0) return ok({ bookmarked: false });

    await db
      .insert(bookmarks)
      .values({ userId: auth.user.id, postId: post.id })
      .onConflictDoNothing();
    return ok({ bookmarked: true });
  });
}
