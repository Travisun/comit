import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { comments, likes, posts, users } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { hooks } from "@/core/hooks";
import { jsonBody, ok, withApi, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { expandMentionTokens, processMentions, rebuildMentions } from "@/lib/mentions";
import { apiUser } from "@/lib/auth/guards";
import { assertNotBlocked } from "@/lib/users";
import { getSetting } from "@/lib/settings";
import { makeExcerpt } from "@/lib/utils";
import { confiscateBannedUser } from "@/lib/banned";
import { getWornBadgesByUsernames } from "@/extensions/badges/server";

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
  /** pinned = 置顶列表（始终置顶渲染）；solutions = 解决方案摘要盒 */
  list: z.enum(["pinned", "solutions"]).optional(),
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
    // 桶 write.comment：per-user 默认 30 次/分钟，zod 校验通过后再计数
    await rateLimitBucket("write.comment", me.id);

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
      // 回复目标是第三个用户：楼上是 A、被回复人是 B 时，只校验 A 会让 B 拉黑后
      // 仍被陌生人直接 @回复并收到通知 —— 可触达互动必须对双方都成立。
      if (parent.userId !== row.post.authorId) {
        await assertNotBlocked(me.id, parent.userId);
      }
    }

    // @提及：解析并重写为稳定引用语法（渲染端按 userId 同步最新昵称）
    const mentionCtx = await processMentions(body, me.id);

    // 评论发布前钩子（扩展可拒绝：频控/合规/自动审核）
    const savingCtx = {
      payload: {
        postId,
        userId: me.id,
        body: mentionCtx.text,
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

    // 审核管线：开启审核（llm/manual）时评论落库即 pending_review（仅作者
    // 自见），由 moderation 队列任务审核；通过后才转 visible + 计入
    // commentCount + 触发 comment:created（通知/webhook 只感知过审评论）。
    const reviewMode = await getSetting("moderation.reviewMode");
    const needsReview = reviewMode === "llm" || reviewMode === "manual";
    const initialStatus = needsReview ? "pending_review" : "visible";

    // 评论插入 + commentCount 自增同事务：两条语句要么全部生效要么全部回滚，
    // 避免插入成功但计数更新失败导致的计数漂移（保持原子自增 +1 方向不变）。
    // 审核模式下计数推迟到过审时（reviewComment）再自增。
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({ ...(savingCtx.payload as typeof comments.$inferInsert), status: initialStatus })
        .returning();
      if (initialStatus === "visible") {
        await tx
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1` })
          .where(eq(posts.id, postId));
      }
      await rebuildMentions(tx, "comment", row.id, me.id, mentionCtx.mentionedUserIds);
      return row;
    });

    // 事务提交后再触发钩子/事件（监听方经连接池读取时行已可见）
    await hooks.callHook("comment:saved", {
      comment: { id: created.id, postId, userId: me.id },
      postAuthorId: row.post.authorId,
    });

    if (needsReview) {
      const { queue } = await import("@/core/queue");
      await queue.send(
        "ext.job",
        { extensionId: "moderation", task: "review", payloadJson: JSON.stringify({ commentId: created.id }) },
        { retryLimit: 2 },
      );
    } else {
      void emit("comment:created", {
        commentId: created.id,
        postId,
        postAuthorId: row.post.authorId,
        commenterId: me.id,
        replyToUserId,
        excerpt: makeExcerpt(body, 120),
      });
    }

    return ok({
      id: created.id,
      // 客户端把本响应直接插入评论列表缓存（不经 GET 的展开出口），
      // 故此处必须展开 @提及，否则新评论直显原始引用语法。
      body: await expandMentionTokens(created.body),
      status: created.status,
      visibility: created.visibility,
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
      list: url.searchParams.get("list") ?? undefined,
    });
    if (!parsed.success) bad();
    const { postId, cursor, limit, list } = parsed.data;

    const [post] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");

    const viewer = await apiUser();

    // 独立列表：置顶（始终置顶渲染）/ 解决方案摘要盒（点击跳对应楼层）。
    // 仅公开可见评论进入这两个列表（私有评论不出现在公共摘要位）。
    if (list === "pinned" || list === "solutions") {
      const flagCol = list === "pinned" ? comments.pinnedAt : comments.solutionAt;
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
          status: users.status,
          bannedUntil: users.bannedUntil,
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.userId))
        .where(
          and(
            eq(comments.postId, postId),
            eq(comments.status, "visible"),
            eq(comments.visibility, "public"),
            isNotNull(flagCol),
          ),
        )
        .orderBy(list === "pinned" ? desc(comments.pinnedAt) : asc(comments.solutionAt))
        .limit(20);
      const isPostAuthor = viewer ? viewer.user.id === post.authorId : false;
      // 展示出口收口：这两个列表同样是正文直出，@提及须展开（与下方主流一致）
      const expandedBodies = await Promise.all(rows.map((r) => expandMentionTokens(r.body)));
      const items = rows.map((r, i) => ({
        id: r.id,
        body: expandedBodies[i],
        createdAt: r.createdAt,
        likeCount: r.likeCount,
        liked: null,
        mine: viewer ? r.userId === viewer.user.id : false,
        canDelete: viewer
          ? r.userId === viewer.user.id || isPostAuthor
          : false,
        canManage: isPostAuthor,
        pinned: list === "pinned",
        solution: list === "solutions",
        user: confiscateBannedUser({
          username: r.username,
          displayName: r.displayName,
          avatarPath: r.avatarPath,
          status: r.status,
          bannedUntil: r.bannedUntil,
        }),
      }));
      return ok({ items, nextCursor: null });
    }

    const replyUsers = alias(users, "reply_users");
    // 可见性合并：他人只见 公开+visible；作者额外自见自己的私密楼层，
    // 但审核中/未通过的评论一律不进楼层（失败由通知承接）
    const statusCond = viewer
      ? and(
          eq(comments.status, "visible"),
          or(eq(comments.visibility, "public"), eq(comments.userId, viewer.user.id)),
        )
      : and(eq(comments.status, "visible"), eq(comments.visibility, "public"));
    const conditions = [eq(comments.postId, postId), statusCond];
    if (cursor) conditions.push(lt(comments.createdAt, new Date(cursor)));
    // 置顶评论走独立列表（list=pinned）在列表顶部渲染 —— 主流排除后
    // 才能保证「无论多少新评论进来，置顶楼层始终在最上方」
    conditions.push(isNull(comments.pinnedAt));

    const rows = await db
      .select({
        id: comments.id,
        body: comments.body,
        status: comments.status,
        visibility: comments.visibility,
        createdAt: comments.createdAt,
        likeCount: comments.likeCount,
        userId: comments.userId,
        replyToCommentId: comments.replyToCommentId,
        replyToUserId: comments.replyToUserId,
        pinnedAt: comments.pinnedAt,
        solutionAt: comments.solutionAt,
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
        authorStatus: users.status,
        authorBannedUntil: users.bannedUntil,
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

    // 佩戴徽章批量注入（按用户名分组）；正文展开 @提及
    const badgeMap = await getWornBadgesByUsernames(page.map((r) => r.username));
    const expandedBodies = await Promise.all(page.map((r) => expandMentionTokens(r.body)));

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

    const items = page.map((r, ri) => ({
      id: r.id,
      body: expandedBodies[ri] ?? r.body,
      status: r.status,
      visibility: r.visibility,
      createdAt: r.createdAt,
      likeCount: r.likeCount,
      liked: viewer ? likedSet.has(r.id) : null, // 键恒存在，响应形状不随登录态漂移
      mine: viewer ? r.userId === viewer.user.id : false,
      // 删除权限：评论作者本人 / 帖子作者 / 被回复评论的作者（管理自己楼下的回复）
      canDelete: viewer
        ? r.userId === viewer.user.id ||
          isPostAuthor ||
          (r.replyToUserId !== null && r.replyToUserId === viewer.user.id)
        : false,
      // 管理权限（置顶/解决方案）：仅帖子作者
      canManage: isPostAuthor,
      pinned: Boolean(r.pinnedAt),
      solution: Boolean(r.solutionAt),
      user: {
        ...confiscateBannedUser({
          username: r.username,
          displayName: r.displayName,
          avatarPath: r.avatarPath,
          status: r.authorStatus,
          bannedUntil: r.authorBannedUntil,
        }),
        badges: badgeMap.get(r.username),
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
    // 删除权限：评论作者本人 / 帖子作者 / 被回复评论的作者（清理自己楼下的回复）
    let parentUserId: string | null = null;
    if (row.comment.replyToCommentId) {
      const [parent] = await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(eq(comments.id, row.comment.replyToCommentId))
        .limit(1);
      parentUserId = parent?.userId ?? null;
    }
    if (
      row.comment.userId !== auth.user.id &&
      row.postAuthorId !== auth.user.id &&
      parentUserId !== auth.user.id
    ) {
      throw forbidden("没有权限删除该评论 / Not allowed to delete this comment");
    }

    if (row.comment.status !== "deleted") {
      // 软删 + 计数递减同事务，防止状态改了计数没减（或反之）的不一致。
      // 审核态（pending_review/rejected）与私有（private）评论从未计入
      // commentCount，递减跳过。
      const wasPubliclyVisible = row.comment.status === "visible" && row.comment.visibility === "public";
      await db.transaction(async (tx) => {
        await tx
          .update(comments)
          .set({ status: "deleted", body: "", pinnedAt: null, solutionAt: null })
          .where(eq(comments.id, id));
        if (wasPubliclyVisible) {
          await tx
            .update(posts)
            .set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` })
            .where(eq(posts.id, row.comment.postId));
        }
      });
    }
    return ok();
  });
}

/** PATCH /api/comments — 博主管理评论：置顶（单槽）/解决方案（可多个）；
 * 评论作者：private/public 切换仅自己可见 ⇄ 公开。 */
const patchSchema = z.object({
  id: z.uuid(),
  action: z.enum(["pin", "unpin", "solve", "unsolve", "private", "public"]),
});

export async function PATCH(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const parsed = patchSchema.safeParse(await jsonBody(req).catch(() => null));
    if (!parsed.success) bad();
    const { id, action } = parsed.data;

    const [row] = await db
      .select({ comment: comments, postAuthorId: posts.authorId })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, id))
      .limit(1);
    if (!row) throw notFound("评论不存在 / Comment not found");

    // 作者可见性切换：仅评论作者本人（自己的内容自己管理）
    if (action === "private" || action === "public") {
      if (row.comment.userId !== auth.user.id) {
        throw forbidden("只有评论作者可以修改可见性 / Only the comment author can change visibility");
      }
      const visibility = action;
      // commentCount 只统计 公开+visible：切换时同步增减（审核态未计数则不动）
      const wasCounted = row.comment.status === "visible" && row.comment.visibility === "public";
      const willCount = row.comment.status === "visible" && visibility === "public";
      await db.transaction(async (tx) => {
        await tx.update(comments).set({ visibility }).where(eq(comments.id, id));
        if (!wasCounted && willCount) {
          await tx
            .update(posts)
            .set({ commentCount: sql`${posts.commentCount} + 1` })
            .where(eq(posts.id, row.comment.postId));
        } else if (wasCounted && !willCount) {
          await tx
            .update(posts)
            .set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` })
            .where(eq(posts.id, row.comment.postId));
        }
      });
      return ok({ ok: true, visibility });
    }

    if (row.postAuthorId !== auth.user.id) {
      throw forbidden("仅帖子作者可以管理评论 / Only the post author can manage comments");
    }
    if (row.comment.status !== "visible") {
      throw forbidden("该评论不可操作 / Comment is not visible");
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      if (action === "pin") {
        // 单槽语义：置顶前清掉同帖其它置顶
        await tx
          .update(comments)
          .set({ pinnedAt: null })
          .where(and(eq(comments.postId, row.comment.postId), eq(comments.status, "visible")));
        await tx.update(comments).set({ pinnedAt: now }).where(eq(comments.id, id));
      } else if (action === "unpin") {
        await tx.update(comments).set({ pinnedAt: null }).where(eq(comments.id, id));
      } else if (action === "solve") {
        // 解决方案允许多个（Discourse 多解扩展语义）
        await tx.update(comments).set({ solutionAt: now }).where(eq(comments.id, id));
      } else {
        await tx.update(comments).set({ solutionAt: null }).where(eq(comments.id, id));
      }
    });

    // 标记解决方案 → 通知评论作者（取消标记不通知）
    if (action === "solve") {
      void emit("comment:solved", {
        commentId: id,
        postId: row.comment.postId,
        commentAuthorId: row.comment.userId,
        postAuthorId: row.postAuthorId,
      });
    }

    return ok({ ok: true });
  });
}
