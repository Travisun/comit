import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, follows, posts } from "@/db/schema";
import { notFound } from "@/core/errors";

/**
 * 互动入口（点赞/收藏/转发）的目标帖可见性门控，与帖子页 postVisibleTo 同口径：
 * 仅已发布内容可互动；private 仅作者；followers 仅作者与关注者。
 * 非作者对草稿/待审/回收站/已删除内容一律按不存在处理（404），
 * 堵住「对隐藏内容产生互动计数并触发作者通知」的探测通道。
 *
 * allowExisting：用户已存在互动记录时放行 —— 作者事后收紧可见性/下架时，
 * 用户仍可以撤销自己的点赞/收藏/转发（toggle-off），不会被 404 卡死。
 */
export async function getInteractablePost(
  postId: string,
  viewerId: string,
  opts: { allowExisting?: () => Promise<boolean> } = {},
) {
  const [post] = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      status: posts.status,
      visibility: posts.visibility,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  const visible =
    post &&
    post.status === "published" &&
    (post.visibility === "public" ||
      post.authorId === viewerId ||
      (post.visibility === "followers" && (await isFollower(viewerId, post.authorId))));

  if (!post || !visible) {
    // 行已物理删除却仍声称有存量互动 → 数据不一致，同样按不存在处理
    if (post && opts.allowExisting && (await opts.allowExisting())) {
      return post;
    }
    throw notFound("内容不存在 / Post not found");
  }
  return post;
}

/** 对评论点赞时：评论本身必须可见，且其所属帖子通过同一互动门控。 */
export async function getInteractableComment(
  commentId: string,
  viewerId: string,
  opts: { allowExisting?: () => Promise<boolean> } = {},
) {
  const [comment] = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      status: comments.status,
      userId: comments.userId,
    })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment || comment.status !== "visible") {
    if (comment && opts.allowExisting && (await opts.allowExisting())) {
      return comment;
    }
    throw notFound("评论不存在 / Comment not found");
  }
  await getInteractablePost(comment.postId, viewerId, opts);
  return comment;
}

async function isFollower(followerId: string, followeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ x: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1);
  return Boolean(row);
}
