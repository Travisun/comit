import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, reposts } from "@/db/schema";
import { AppError } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getInteractablePost } from "@/lib/interactions";

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

    // 桶 action.social：per-user 默认 60 次/60s，覆盖 toggle 高频场景
    await rateLimitBucket("action.social", me);

    // 已转发过的帖放行，保证作者收紧可见性后用户仍能撤销
    const existingRepost = async () => {
      const [row] = await db
        .select({ x: reposts.userId })
        .from(reposts)
        .where(and(eq(reposts.userId, me), eq(reposts.postId, postId)))
        .limit(1);
      return Boolean(row);
    };
    const post = await getInteractablePost(postId, me, { allowExisting: existingRepost });

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

    // 单条原子 SQL：UPDATE … SET repost_count = (SELECT COUNT(*) …)，
    // 消除 select→update 读改写竞态；RETURNING 取回最新计数。
    const [row] = await db
      .update(posts)
      .set({
        repostCount: sql`(SELECT COUNT(*) FROM ${reposts} WHERE ${reposts.postId} = ${postId})`,
      })
      .where(eq(posts.id, postId))
      .returning({ repostCount: posts.repostCount });
    const n = row?.repostCount ?? 0;

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
