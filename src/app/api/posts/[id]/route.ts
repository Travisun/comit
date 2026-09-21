import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { follows, posts } from "@/db/schema";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { preSubmitCheck } from "@/lib/moderation";
import { processMentions, rebuildMentions } from "@/lib/mentions";
import { authorize } from "@/core/capabilities/policies";
import { updatePostWithHooks } from "../_shared";
import {
  assertCollectionOwned,
  assertOwnedMedia,
  blockedResponse,
  ensureSummary,
  existingLabelColumns,
  getAuthorPost,
  labelFieldsSchema,
  parseWith,
  resolveLabelFields,
  SHORT_CONTENT_MAX,
  syncPostTopics,
  topicNamesOf,
  topicNamesSchema,
} from "../_shared";

/**
 * GET    /api/posts/[id] — author: any status (incl. moderation/rejectReason);
 *                          others: published only (404 otherwise).
 * PUT    /api/posts/[id] — author only; fields + topicNames reset + draft
 *                          transitions + action:'submit' flow. Published posts
 *                          keep their status on content edits.
 * DELETE /api/posts/[id] — author only.
 */
const idSchema = z.uuid();

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
  summary: z.string().trim().max(500).nullish(),
  visibility: z.enum(["public", "followers", "private"]).optional(),
  collectionId: z.uuid().nullish(),
  coverPath: z.string().trim().min(1).max(500).nullish(),
  topicNames: topicNamesSchema,
  slug: z.string().trim().max(180).optional(),
  ...labelFieldsSchema,
  /** move back to draft (from pending_review / rejected / published) */
  status: z.literal("draft").optional(),
  action: z.enum(["draft", "submit"]).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound("内容不存在 / Post not found");

    const names = await topicNamesOf(post.id);
    if (post.authorId === auth.user.id) return ok({ ...post, topicNames: names });
    // 非作者：仅已发布且非私有内容可见（private 仅作者自见；
    // followers 与帖子页 postVisibleTo 同口径 —— 需关注，否则按不存在处理）
    if (post.status !== "published" || post.visibility === "private") {
      throw notFound("内容不存在 / Post not found");
    }
    if (post.visibility === "followers") {
      const [f] = await db
        .select({ x: follows.followerId })
        .from(follows)
        .where(and(eq(follows.followerId, auth.user.id), eq(follows.followeeId, post.authorId)))
        .limit(1);
      if (!f) throw notFound("内容不存在 / Post not found");
    }
    // non-authors never see moderation internals
    return ok({
      id: post.id,
      authorId: post.authorId,
      type: post.type,
      publicId: post.publicId,
      title: post.title,
      summary: post.summary,
      content: post.content,
      coverPath: post.coverPath,
      collectionId: post.collectionId,
      status: post.status,
      visibility: post.visibility,
      label: post.label,
      sourceUrl: post.sourceUrl,
      sourceName: post.sourceName,
      views: post.views,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      repostCount: post.repostCount,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      topicNames: names,
    });
  });
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const post = await getAuthorPost(id, auth.user.id);
    const body = parseWith(updateSchema, await jsonBody(req));
    // 编辑与创建分开计桶：创建 10/小时对写作足够，但每次保存已发布内容都会把它
    // 打回 pending_review（重审 + 钩子 + 提及重建），无上限即可用廉价 PUT 循环
    // 把审核队列和下游开销刷满；30/分钟对人手工编辑不会误伤。
    await rateLimitBucket("write.post.edit", auth.user.id);

    const nextContentRaw = body.content ?? post.content;
    if (post.type === "short" && nextContentRaw.length > SHORT_CONTENT_MAX) {
      throw new AppError(`短动态内容不能超过 ${SHORT_CONTENT_MAX} 字`, 400, "too_long");
    }
    // @提及：编辑内容时重新解析（旧提及记录清空后按新内容重建）
    const mentionCtx = await processMentions(nextContentRaw, auth.user.id);
    const nextContent = mentionCtx.text;
    if (body.title !== undefined && post.type === "article" && !body.title.trim()) {
      throw new AppError("文章必须有标题 / Articles require a title", 400, "validation_error");
    }
    if (body.collectionId) await assertCollectionOwned(body.collectionId, auth.user.id);
    // 封面必须来自本人媒体库（与创建同口径，见 _shared.assertOwnedMedia）
    if (body.coverPath) await assertOwnedMedia(auth.user.id, [body.coverPath]);

    // hard keyword gate for submit — nothing changes when blocked
    if (body.action === "submit") {
      const title = body.title ?? post.title;
      const { blocked } = await preSubmitCheck(title ?? "", nextContent);
      if (blocked.length) return blockedResponse(blocked);
    }

    const title = body.title?.trim() ?? post.title;
    const summary =
      body.summary === undefined ? post.summary : ensureSummary(body.summary, nextContent || title || "");
    // annotation: untouched when `label` is omitted; otherwise validated and
    // non-repost labels clear any previously stored source fields
    const labelColumns =
      body.label === undefined
        ? existingLabelColumns(post)
        : resolveLabelFields(body.label, body.sourceUrl, body.sourceName, {
            sourceUrl: post.sourceUrl,
            sourceName: post.sourceName,
          });

    // 审核闭环：已发布内容的任何编辑都必须重新走审核管线
    //（防过审后改文绕审）；重审期间回到 pending_review（他人暂不可见），
    // 过审后恢复发布并照常触发 post:published（提及通知/徽章评估等下游）
    const wasPublished = post.status === "published";
    const nextStatus = wasPublished
      ? "pending_review"
      : body.action === "submit"
        ? "pending_review"
        : (body.status ?? post.status);

    const updated = await updatePostWithHooks(
      post.id,
      {
        title,
        content: nextContent,
        summary,
        visibility: body.visibility ?? post.visibility,
        collectionId:
          body.collectionId !== undefined ? (body.collectionId ?? null) : post.collectionId,
        coverPath: body.coverPath !== undefined ? (body.coverPath ?? null) : post.coverPath,
        status: nextStatus,
        ...labelColumns,
        rejectReason: nextStatus === "pending_review" ? null : post.rejectReason,
        updatedAt: new Date(),
      },
      { id: auth.user.id, username: auth.user.username, role: auth.user.role },
    );

    const topicNames = body.topicNames;
    if (topicNames !== undefined) {
      await db.transaction(async (tx) => {
        await syncPostTopics(tx, post.id, topicNames);
      });
    }

    // 重建提及记录（内容变更 → 新提及集合；通知在内容可见时 flush）
    // 删+插同事务：避免中途失败留下"提及被清空但未重建"的窗口
    await db.transaction(async (tx) => {
      await rebuildMentions(tx, "post", post.id, auth.user.id, mentionCtx.mentionedUserIds);
    });

    // 重新进入审核队列（草稿首次提审 / 过审后编辑重审）：
    // reviewMode=off 时 moderation 插件会立即发布
    if (nextStatus === "pending_review") {
      await emit("post:submitted", {
        postId: post.id,
        authorId: auth.user.id,
        title: updated.title ?? "",
        needReview: true,
      });
    }

    const names = await topicNamesOf(post.id);
    return ok({ ...updated, topicNames: names });
  });
}

/**
 * PATCH /api/posts/[id] — 轻量切换作者可见性（右上角菜单用）：
 * { visibility: "public" | "private" }。仅作者本人；不触碰 status/publishedAt。
 */
const patchSchema = z.object({ visibility: z.enum(["public", "private"]) });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const post = await getAuthorPost(id, auth.user.id);
    const body = parseWith(patchSchema, await jsonBody(req));

    await db
      .update(posts)
      .set({ visibility: body.visibility, updatedAt: new Date() })
      .where(eq(posts.id, post.id));

    return ok({ id: post.id, visibility: body.visibility });
  });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const purge = new URL(req.url).searchParams.get("purge") === "true";
    const post = await getAuthorPost(id, auth.user.id);
    await authorize(auth.user, "post.delete", post);

    if (purge) {
      // permanent removal from the recycle bin — everything goes
      await db.delete(posts).where(and(eq(posts.id, post.id), eq(posts.authorId, auth.user.id)));
      return ok({ id: post.id, deleted: true, purged: true });
    }

    // soft delete → recycle bin (keeps comments/likes; restorable)
    await db
      .update(posts)
      .set({
        status: "deleted",
        preDeleteStatus: post.status,
        deletedAt: new Date(),
      })
      .where(and(eq(posts.id, post.id), eq(posts.authorId, auth.user.id)));
    return ok({ id: post.id, deleted: true });
  });
}
