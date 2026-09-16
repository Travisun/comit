import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, likes, posts } from "@/db/schema";
import { notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { rateLimitAction, defineAction } from "@/core/capabilities/actions";

/**
 * 点赞切换（Action 层示范 — 原 route.ts 的完整业务，现为声明式定义）。
 * route.ts 退化为 3 行接线：`export const POST = (req) => runAction(req, toggleLike)`。
 */
export const toggleLike = defineAction({
  name: "likes.toggle",
  method: "POST",
  path: "/api/likes",
  auth: "user",
  middleware: [rateLimitAction("likes", 60, 60_000)],
  input: z.object({
    targetType: z.enum(["post", "comment"]),
    targetId: z.uuid(),
  }),
  async handler({ input, user }) {
    const { targetType, targetId } = input;
    const userId = user!.id;

    // target must exist (and give us the author for events)
    let authorId: string;
    if (targetType === "post") {
      const [post] = await db
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, targetId))
        .limit(1);
      if (!post) throw notFound("内容不存在 / Post not found");
      authorId = post.authorId;
    } else {
      const [c] = await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(eq(comments.id, targetId))
        .limit(1);
      if (!c) throw notFound("评论不存在 / Comment not found");
      authorId = c.userId;
    }

    // toggle (race-safe)
    const removed = await db
      .delete(likes)
      .where(
        and(
          eq(likes.userId, userId),
          eq(likes.targetType, targetType),
          eq(likes.targetId, targetId),
        ),
      )
      .returning({ userId: likes.userId });

    let liked: boolean;
    if (removed.length > 0) {
      liked = false;
    } else {
      // insert now, or it already exists from a concurrent like — either way: liked
      await db
        .insert(likes)
        .values({ userId, targetType, targetId })
        .onConflictDoNothing();
      liked = true;
    }

    // recount from source of truth
    const [{ n }] = await db
      .select({ n: count() })
      .from(likes)
      .where(and(eq(likes.targetType, targetType), eq(likes.targetId, targetId)));

    if (targetType === "post") {
      await db.update(posts).set({ likeCount: n }).where(eq(posts.id, targetId));
      if (liked) {
        void emit("post:liked", { postId: targetId, actorId: userId, authorId });
      }
    } else {
      await db.update(comments).set({ likeCount: n }).where(eq(comments.id, targetId));
      if (liked) {
        void emit("comment:liked", {
          commentId: targetId,
          actorId: userId,
          commentAuthorId: authorId,
        });
      }
    }

    return { liked, count: n };
  },
});
