import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts, reposts } from "@/db/schema";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";

const bodySchema = z.object({
  postId: z.uuid(),
  comment: z.string().trim().min(1).max(280).optional(),
});

/** POST /api/reposts — toggle a repost (with optional comment) on a post. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { postId, comment } = parsed.data;
    const me = auth.user.id;

    const [post] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) throw notFound("内容不存在 / Post not found");

    const removed = await db
      .delete(reposts)
      .where(and(eq(reposts.userId, me), eq(reposts.postId, postId)))
      .returning({ id: reposts.id });

    let reposted: boolean;
    if (removed.length > 0) {
      reposted = false;
    } else {
      // insert now, or it already exists from a concurrent repost — either way: reposted
      await db
        .insert(reposts)
        .values({ userId: me, postId, comment: comment ?? null })
        .onConflictDoNothing();
      reposted = true;
    }

    const [{ n }] = await db
      .select({ n: count() })
      .from(reposts)
      .where(eq(reposts.postId, postId));
    await db.update(posts).set({ repostCount: n }).where(eq(posts.id, postId));

    if (reposted) {
      void emit("post:reposted", {
        postId,
        actorId: me,
        authorId: post.authorId,
      });
    }

    return ok({ reposted, count: n });
  });
}
