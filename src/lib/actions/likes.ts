import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, likes, posts } from "@/db/schema";
import { emit } from "@/core/events";
import { rateLimitAction, defineAction } from "@/core/capabilities/actions";
import { getInteractableComment, getInteractablePost } from "@/lib/interactions";
import { assertNotBlocked } from "@/lib/users";

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

    // target must be visible to the actor (and give us the author for events);
    // 已有同条互动时放行，保证作者收紧可见性后用户仍能撤销
    const existingLike = async () => {
      const [row] = await db
        .select({ x: likes.userId })
        .from(likes)
        .where(
          and(
            eq(likes.userId, userId),
            eq(likes.targetType, targetType),
            eq(likes.targetId, targetId),
          ),
        )
        .limit(1);
      return Boolean(row);
    };
    const gate = { allowExisting: existingLike };
    let authorId: string;
    if (targetType === "post") {
      const post = await getInteractablePost(targetId, userId, gate);
      authorId = post.authorId;
    } else {
      const c = await getInteractableComment(targetId, userId, gate);
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
    let newlyLiked = false;
    if (removed.length > 0) {
      liked = false;
    } else {
      // 拉黑关系双向拒绝：点赞会给对方推通知，属「可触达」互动。只在将要插入时
      // 校验（撤销路径已在上面的 delete 命中并返回），保证作者拉黑后用户仍能把
      // 自己的旧赞取消掉。
      if (authorId !== userId) await assertNotBlocked(authorId, userId);
      // insert now, or it already exists from a concurrent like — either way: liked.
      // 「是否本次新插」必须由插入结果判定（RETURNING 有行 ⇒ 本次真正插入成功）：
      // 之前用插入前的 select 推导，两个并发 toggle 请求都看不到对方的行，于是
      // 各发一次 post:liked/comment:liked，作者收到重复点赞通知。冲突未插入 ⇒
      // 通知由并发的那次请求负责，此处静默；liked 仍为 true（行确实存在）。
      const inserted = await db
        .insert(likes)
        .values({ userId, targetType, targetId })
        .onConflictDoNothing()
        .returning({ userId: likes.userId });
      newlyLiked = inserted.length > 0;
      liked = true;
    }

    // recount from source of truth — 单条原子 SQL：
    // UPDATE … SET like_count = (SELECT COUNT(*) FROM likes WHERE …)，
    // 消除 select→update 读改写竞态（并发 toggle 互相覆盖计数）。
    // camelCase 映射由 drizzle 查询构建器保持，RETURNING 取回最新计数。
    let n: number;
    if (targetType === "post") {
      const [row] = await db
        .update(posts)
        .set({
          likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.targetType} = ${targetType} AND ${likes.targetId} = ${targetId})`,
        })
        .where(eq(posts.id, targetId))
        .returning({ likeCount: posts.likeCount });
      n = row?.likeCount ?? 0;
      if (newlyLiked) {
        void emit("post:liked", { postId: targetId, actorId: userId, authorId });
      }
    } else {
      const [row] = await db
        .update(comments)
        .set({
          likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.targetType} = ${targetType} AND ${likes.targetId} = ${targetId})`,
        })
        .where(eq(comments.id, targetId))
        .returning({ likeCount: comments.likeCount });
      n = row?.likeCount ?? 0;
      if (newlyLiked) {
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
