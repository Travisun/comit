import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { preSubmitCheck } from "@/lib/moderation";
import {
  assertCollectionOwned,
  blockedResponse,
  ensureSummary,
  existingLabelColumns,
  getAuthorPost,
  labelFieldsSchema,
  parseWith,
  resolveArticleSlug,
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
  visibility: z.enum(["public", "followers"]).optional(),
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
    if (post.status !== "published") throw notFound("内容不存在 / Post not found");
    // non-authors never see moderation internals
    return ok({
      id: post.id,
      authorId: post.authorId,
      type: post.type,
      slug: post.slug,
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

    const nextContent = body.content ?? post.content;
    if (post.type === "short" && nextContent.length > SHORT_CONTENT_MAX) {
      throw new AppError(`短动态内容不能超过 ${SHORT_CONTENT_MAX} 字`, 400, "too_long");
    }
    if (body.title !== undefined && post.type === "article" && !body.title.trim()) {
      throw new AppError("文章必须有标题 / Articles require a title", 400, "validation_error");
    }
    if (body.collectionId) await assertCollectionOwned(body.collectionId, auth.user.id);

    // hard keyword gate for submit — nothing changes when blocked
    if (body.action === "submit") {
      const title = body.title ?? post.title;
      const { blocked } = await preSubmitCheck(title ?? "", nextContent);
      if (blocked.length) return blockedResponse(blocked);
    }

    const title = body.title?.trim() ?? post.title;
    const slug =
      body.slug !== undefined && post.type === "article" && body.slug.trim() !== ""
        ? await resolveArticleSlug(auth.user.id, title ?? "", body.slug, post.id)
        : post.slug;
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

    // published posts keep status/publishedAt — content-only update
    const wasPublished = post.status === "published";
    const nextStatus = wasPublished
      ? "published"
      : body.action === "submit"
        ? "pending_review"
        : (body.status ?? post.status);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(posts)
        .set({
          title,
          content: nextContent,
          summary,
          slug,
          visibility: body.visibility ?? post.visibility,
          collectionId:
            body.collectionId !== undefined ? (body.collectionId ?? null) : post.collectionId,
          coverPath: body.coverPath !== undefined ? (body.coverPath ?? null) : post.coverPath,
          status: nextStatus,
          ...labelColumns,
          rejectReason:
            body.action === "submit" || body.status === "draft" ? null : post.rejectReason,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, post.id))
        .returning();
      if (body.topicNames !== undefined) await syncPostTopics(tx, post.id, body.topicNames);
      return row;
    });

    if (body.action === "submit" && !wasPublished) {
      // reviewMode=off → moderation plugin publishes immediately
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

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const post = await getAuthorPost(id, auth.user.id);
    await db.delete(posts).where(and(eq(posts.id, post.id), eq(posts.authorId, auth.user.id)));
    return ok({ id: post.id, deleted: true });
  });
}
