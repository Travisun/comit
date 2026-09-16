import { z } from "zod";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { comments, likes, posts, users } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { hooks } from "@/core/hooks";
import { jsonBody, ok, withApi, withUser } from "@/lib/http";
import { apiUser } from "@/lib/auth/guards";
import { assertNotBlocked } from "@/lib/users";
import { makeExcerpt } from "@/lib/utils";

const createSchema = z.object({
  postId: z.uuid(),
  body: z.string().trim().min(1).max(2000),
  replyToCommentId: z.uuid().optional(),
});

const listSchema = z.object({
  postId: z.uuid(),
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "invalid cursor")
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function bad(): never {
  throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
}

/** POST /api/comments — create a comment on a published post. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = createSchema.safeParse(await jsonBody(req));
    if (!parsed.success) bad();
    const { postId, body, replyToCommentId } = parsed.data;
    const me = auth.user;

    const [row] = await db
      .select({ post: posts, authorCommentsEnabled: users.commentsEnabled })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.id, postId))
      .limit(1);
    if (!row || row.post.status !== "published") {
      throw notFound("文章不存在 / Post not found");
    }
    if (!row.authorCommentsEnabled) {
      throw forbidden("作者已关闭评论 / Comments are closed");
    }
    await assertNotBlocked(me.id, row.post.authorId);

    let replyToUserId: string | null = null;
    let replyToUsername: string | null = null;
    if (replyToCommentId) {
      const replyUsers = alias(users, "reply_users");
      const [parent] = await db
        .select({
          id: comments.id,
          postId: comments.postId,
          status: comments.status,
          userId: comments.userId,
          username: replyUsers.username,
        })
        .from(comments)
        .innerJoin(replyUsers, eq(replyUsers.id, comments.userId))
        .where(eq(comments.id, replyToCommentId))
        .limit(1);
      if (!parent || parent.postId !== postId || parent.status !== "visible") {
        throw notFound("回复的评论不存在 / Reply target not found");
      }
      replyToUserId = parent.userId;
      replyToUsername = parent.username;
    }

    // 评论发布前钩子（扩展可拒绝：频控/合规/自动审核）
    const savingCtx = {
      payload: {
        postId,
        userId: me.id,
        body,
        replyToCommentId: replyToCommentId ?? null,
        replyToUserId,
      } as Record<string, unknown>,
      rejection: null as string | null,
      reject(reason: string) {
        savingCtx.rejection = reason;
      },
    };
    await hooks.callHook("comment:saving", savingCtx);
    if (savingCtx.rejection) {
      throw new AppError(savingCtx.rejection, 422, "extension_rejected");
    }

    const [created] = await db
      .insert(comments)
      .values(savingCtx.payload as typeof comments.$inferInsert)
      .returning();

    await hooks.callHook("comment:saved", {
      comment: { id: created.id, postId, userId: me.id },
      postAuthorId: row.post.authorId,
    });

    await db
      .update(posts)
      .set({ commentCount: sql`${posts.commentCount} + 1` })
      .where(eq(posts.id, postId));

    void emit("comment:created", {
      commentId: created.id,
      postId,
      postAuthorId: row.post.authorId,
      commenterId: me.id,
      replyToUserId,
      excerpt: makeExcerpt(body, 120),
    });

    return ok({
      id: created.id,
      body: created.body,
      createdAt: created.createdAt,
      likeCount: created.likeCount,
      liked: false,
      mine: true,
      canDelete: true,
      user: {
        username: me.username,
        displayName: me.displayName,
        avatarPath: me.avatarPath,
      },
      replyToCommentId: created.replyToCommentId,
      replyToUsername,
    });
  });
}

/** GET /api/comments?postId=&cursor=&limit= — cursor-paginated flat list. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const url = new URL(req.url);
    const parsed = listSchema.safeParse({
      postId: url.searchParams.get("postId") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) bad();
    const { postId, cursor, limit } = parsed.data;

    const [post] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");

    const viewer = await apiUser();

    const replyUsers = alias(users, "reply_users");
    const conditions = [eq(comments.postId, postId), eq(comments.status, "visible")];
    if (cursor) conditions.push(lt(comments.createdAt, new Date(cursor)));

    const rows = await db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        likeCount: comments.likeCount,
        userId: comments.userId,
        replyToCommentId: comments.replyToCommentId,
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
        replyToUsername: replyUsers.username,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(replyUsers, eq(replyUsers.id, comments.replyToUserId))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    let likedSet = new Set<string>();
    if (viewer && page.length > 0) {
      const likedRows = await db
        .select({ targetId: likes.targetId })
        .from(likes)
        .where(
          and(
            eq(likes.userId, viewer.user.id),
            eq(likes.targetType, "comment"),
            inArray(
              likes.targetId,
              page.map((r) => r.id),
            ),
          ),
        );
      likedSet = new Set(likedRows.map((r) => r.targetId));
    }
    const isPostAuthor = viewer ? viewer.user.id === post.authorId : false;

    const items = page.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      likeCount: r.likeCount,
      liked: viewer ? likedSet.has(r.id) : undefined,
      mine: viewer ? r.userId === viewer.user.id : false,
      canDelete: viewer ? r.userId === viewer.user.id || isPostAuthor : false,
      user: {
        username: r.username,
        displayName: r.displayName,
        avatarPath: r.avatarPath,
      },
      replyToCommentId: r.replyToCommentId,
      replyToUsername: r.replyToUsername ?? null,
    }));

    return ok({
      items,
      nextCursor:
        hasMore && page.length > 0 ? page[page.length - 1].createdAt.toISOString() : null,
      viewerId: viewer ? viewer.user.id : null,
    });
  });
}

/** DELETE /api/comments?id= — soft delete (comment author or post author). */
export async function DELETE(req: Request) {
  return withUser(req, async (auth) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!z.uuid().safeParse(id).success) bad();

    const [row] = await db
      .select({ comment: comments, postAuthorId: posts.authorId })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, id))
      .limit(1);
    if (!row) throw notFound("评论不存在 / Comment not found");
    if (row.comment.userId !== auth.user.id && row.postAuthorId !== auth.user.id) {
      throw forbidden("没有权限删除该评论 / Not allowed to delete this comment");
    }

    if (row.comment.status !== "deleted") {
      await db
        .update(comments)
        .set({ status: "deleted", body: "" })
        .where(eq(comments.id, id));
      await db
        .update(posts)
        .set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` })
        .where(eq(posts.id, row.comment.postId));
    }
    return ok();
  });
}
