import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { collections, postTopics, posts, topics, type Post } from "@/db/schema";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { makeExcerpt, slugifyTitle } from "@/lib/utils";
import { preSubmitCheck } from "@/lib/moderation";
import {
  CONTENT_LABEL_IDS,
  getLabelDef,
  isHttpUrl,
  type ContentLabelId,
} from "@/lib/content-labels";

/**
 * Shared helpers for /api/posts/*: zod schemas, slug/topic resolution and the
 * submit flow (pre-submit keyword check → pending_review → post:submitted).
 * The moderation plugin listens on that event and publishes or queues review
 * depending on `moderation.reviewMode`.
 */

export const SHORT_CONTENT_MAX = 8000;

/* --------------------------- content annotation --------------------------- */

/** label enum — kept in sync with posts.label (varchar(24)). */
export const contentLabelSchema = z.enum(CONTENT_LABEL_IDS);

/** Raw annotation fields accepted in POST / PUT bodies. */
export const labelFieldsSchema = {
  label: contentLabelSchema.optional(),
  sourceUrl: z.string().trim().max(2048).optional(),
  sourceName: z.string().trim().max(200).optional(),
};

/** Normalized annotation columns persisted on the posts row. */
export interface LabelColumns {
  label: ContentLabelId;
  sourceUrl: string | null;
  sourceName: string | null;
}

/**
 * Resolve annotation fields for persistence:
 * - repost requires a http(s) sourceUrl (falls back to the row's existing one
 *   on PUT so editors don't have to re-enter it);
 * - every other label clears / ignores sourceUrl + sourceName.
 */
export function resolveLabelFields(
  label: ContentLabelId,
  sourceUrl: string | undefined,
  sourceName: string | undefined,
  fallback?: { sourceUrl: string | null; sourceName: string | null },
): LabelColumns {
  if (getLabelDef(label).needsSource) {
    const url = (sourceUrl ?? fallback?.sourceUrl ?? "").trim();
    if (!isHttpUrl(url)) {
      throw new AppError(
        "转载内容需填写原文地址 / Reposts require a valid http(s) source URL",
        400,
        "validation_error",
      );
    }
    const name = (sourceName ?? fallback?.sourceName ?? "").trim();
    return { label, sourceUrl: url, sourceName: name ? name.slice(0, 200) : null };
  }
  return { label, sourceUrl: null, sourceName: null };
}

/** Annotation columns for an existing row whose label was not resubmitted. */
export function existingLabelColumns(row: {
  label: string;
  sourceUrl: string | null;
  sourceName: string | null;
}): LabelColumns {
  return {
    label: getLabelDef(row.label).id,
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
  };
}

export const topicNamesSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(5)
  .optional();

/** Parse a JSON body with zod; map failures to a 400 AppError. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new AppError(`${where}${issue.message}`, 400, "validation_error");
  }
  return res.data;
}

export async function getAuthorPost(postId: string, authorId: string) {
  const [post] = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.authorId, authorId),
        // recycle-bin posts are managed through restore/purge endpoints
        ne(posts.status, "deleted"),
      ),
    )
    .limit(1);
  if (!post) throw notFound("文章不存在 / Post not found");
  return post;
}

export async function topicNamesOf(postId: string): Promise<string[]> {
  const rows = await db
    .select({ name: topics.name })
    .from(postTopics)
    .innerJoin(topics, eq(topics.id, postTopics.topicId))
    .where(eq(postTopics.postId, postId));
  return rows.map((r) => r.name);
}

/** CJK-safe slug for topics / collections (slugify strips CJK → fallback). */
export function normalizeSlug(name: string): string {
  const s = slugifyTitle(name);
  const fallback = name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 100);
  const out = (s.startsWith("post-") && !name.match(/^[a-z0-9]/i) ? fallback : s).replace(
    /[^a-z0-9\u4e00-\u9fff-]/gi,
    "",
  );
  return out || fallback || `t-${Date.now().toString(36)}`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Upsert topics by slug, then reset the post↔topic links (≤5 enforced). */
export async function syncPostTopics(tx: Tx, postId: string, names: string[]): Promise<void> {
  const seen = new Set<string>();
  const cleaned: { name: string; slug: string }[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) continue;
    const slug = normalizeSlug(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    cleaned.push({ name, slug });
  }
  for (const t of cleaned) {
    await tx.insert(topics).values({ slug: t.slug, name: t.name }).onConflictDoNothing({
      target: topics.slug,
    });
  }
  const rows = cleaned.length
    ? await tx.select().from(topics).where(inArray(topics.slug, cleaned.map((t) => t.slug)))
    : [];
  await tx.delete(postTopics).where(eq(postTopics.postId, postId));
  if (rows.length) {
    await tx
      .insert(postTopics)
      .values(rows.map((r) => ({ postId, topicId: r.id })))
      .onConflictDoNothing();
  }
}

export async function assertCollectionOwned(collectionId: string, userId: string) {
  const [row] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .limit(1);
  if (!row) throw notFound("合集不存在 / Collection not found");
}

export interface SubmitCheckResult {
  blocked: string[];
  warned: string[];
}

/** Hard keyword gate before a post enters the review pipeline. */
export async function runSubmitCheck(
  post: { id: string; authorId: string; title: string | null; content: string },
): Promise<SubmitCheckResult & { submitted: boolean }> {
  const { blocked, warned } = await preSubmitCheck(post.title ?? "", post.content);
  if (blocked.length) return { blocked, warned, submitted: false };
  await db
    .update(posts)
    .set({ status: "pending_review", rejectReason: null, updatedAt: new Date() })
    .where(eq(posts.id, post.id));
  await emit("post:submitted", {
    postId: post.id,
    authorId: post.authorId,
    title: post.title ?? "",
    needReview: true,
  });
  return { blocked: [], warned, submitted: true };
}

/** 422 JSON body used by the editor to show blocked keywords. */
export function blockedResponse(blocked: string[]): Response {
  return Response.json(
    {
      error: `内容包含被禁止的关键词：${blocked.join("、")}`,
      code: "blocked_keywords",
      blocked,
    },
    { status: 422 },
  );
}

/** Regenerate summary when empty/null. */
export function ensureSummary(summary: string | null | undefined, content: string): string {
  const trimmed = (summary ?? "").trim();
  return (trimmed || makeExcerpt(content)).slice(0, 500);
}

/**
 * 带生命周期钩子的帖子更新（原 src/lib/post-repo.ts 唯一存活能力，仓储层
 * 已退役收编至此 —— create 的钩子语义由 /api/posts 的事务内联实现承担）。
 * 触发 post:saving（扩展可 reject → 422）与 post:saved（提交后）。
 */
export async function updatePostWithHooks(
  postId: string,
  values: Partial<typeof posts.$inferInsert>,
  author: { id: string; username: string; role: string },
): Promise<Post> {
  const { runPostSaving, runPostSaved } = await import("@/core/capabilities/post-lifecycle");
  const payload: Record<string, unknown> = { ...values };
  const ctx = {
    action: "update" as const,
    postId,
    payload,
    author,
    rejection: null as string | null,
    reject(reason: string) {
      ctx.rejection = reason;
    },
  };
  await runPostSaving(ctx);
  if (ctx.rejection) {
    const { AppError } = await import("@/core/errors");
    throw new AppError(ctx.rejection, 422, "extension_rejected");
  }
  const [row] = await db
    .update(posts)
    .set(payload as Partial<typeof posts.$inferInsert>)
    .where(eq(posts.id, postId))
    .returning();
  await runPostSaved({
    action: "update",
    post: { id: row.id, type: row.type, status: row.status, title: row.title },
    author: { id: author.id },
  });
  return row;
}
