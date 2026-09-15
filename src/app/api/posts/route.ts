import { z } from "zod";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { jsonBody, ok, withUser } from "@/lib/http";
import { routes } from "@/core/routes";
import { emit } from "@/core/events";
import { preSubmitCheck } from "@/lib/moderation";
import { DEFAULT_LABEL } from "@/lib/content-labels";
import {
  assertCollectionOwned,
  blockedResponse,
  ensureSummary,
  labelFieldsSchema,
  parseWith,
  resolveArticleSlug,
  resolveLabelFields,
  SHORT_CONTENT_MAX,
  syncPostTopics,
  topicNamesSchema,
} from "./_shared";

/**
 * POST /api/posts — create an article or a short post.
 * body: { type, title?, content, summary?, slug?, collectionId?,
 *         topicNames?(≤5), visibility?, coverPath?, mediaPaths?(short images),
 *         label?, sourceUrl?, sourceName?, action: 'draft'|'submit' }
 * → 200 post | 422 { error, blocked } when the hard keyword check fails.
 */
const createSchema = z
  .object({
    type: z.enum(["article", "short"]),
    title: z.string().trim().max(200).optional(),
    content: z.string().max(200_000).default(""),
    summary: z.string().trim().max(500).optional(),
    slug: z.string().trim().max(180).optional(),
    collectionId: z.uuid().nullish(),
    topicNames: topicNamesSchema,
    visibility: z.enum(["public", "followers"]).optional(),
    coverPath: z.string().trim().min(1).max(500).nullish(),
    mediaPaths: z.array(z.string().trim().min(1).max(500)).max(9).optional(),
    ...labelFieldsSchema,
    action: z.enum(["draft", "submit"]),
  })
  .refine((v) => v.type !== "article" || v.content.trim().length > 0, {
    message: "文章内容不能为空 / Article content cannot be empty",
    path: ["content"],
  })
  .refine(
    (v) =>
      v.type !== "short" ||
      (v.content.length <= SHORT_CONTENT_MAX &&
        (v.content.trim().length > 0 || (v.mediaPaths?.length ?? 0) > 0)),
    {
      message: `短动态最多 ${SHORT_CONTENT_MAX} 字，文字与图片至少其一（支持纯图片）`,
      path: ["content"],
    },
  );

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const body = parseWith(createSchema, await jsonBody(req));
    const type = body.type;
    const title = body.title?.trim() || null;

    // short-post images are appended to content as markdown image syntax
    const imageMarkdown = (body.mediaPaths ?? [])
      .map((p) => `![](${p.startsWith("/") ? p : routes.media(p)})`)
      .join("\n");
    const content =
      type === "short" && imageMarkdown
        ? `${body.content.trim()}${body.content.trim() ? "\n\n" : ""}${imageMarkdown}`
        : body.content;

    if (body.collectionId) await assertCollectionOwned(body.collectionId, auth.user.id);

    // hard keyword gate — nothing is persisted when blocked
    if (body.action === "submit") {
      const { blocked } = await preSubmitCheck(title ?? "", content);
      if (blocked.length) return blockedResponse(blocked);
    }

    const slug = type === "article" ? await resolveArticleSlug(auth.user.id, body.slug) : null;
    const summary = ensureSummary(body.summary, content || title || "");
    const labelColumns = resolveLabelFields(
      body.label ?? DEFAULT_LABEL,
      body.sourceUrl,
      body.sourceName,
    );

    const post = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(posts)
        .values({
          authorId: auth.user.id,
          type,
          slug,
          title,
          summary,
          content,
          coverPath: body.coverPath ?? null,
          collectionId: body.collectionId ?? null,
          status: body.action === "submit" ? "pending_review" : "draft",
          visibility: body.visibility ?? "public",
          ...labelColumns,
        })
        .returning();
      if (body.topicNames?.length) await syncPostTopics(tx, row.id, body.topicNames);
      return row;
    });

    if (body.action === "submit") {
      // reviewMode=off → the moderation plugin publishes right away and emits
      // post:published; otherwise it queues the review pipeline.
      await emit("post:submitted", {
        postId: post.id,
        authorId: auth.user.id,
        title: post.title ?? "",
        needReview: true,
      });
    }

    return ok(post);
  });
}
