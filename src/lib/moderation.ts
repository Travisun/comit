import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { keywords, posts, type Post } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { emit } from "@/core/events";
import { markdownToPlain } from "@/lib/utils";
import { llmChat } from "@/lib/llm";

/**
 * Content moderation pipeline:
 *  1. Hard keyword scan (block/warn lists, admin-managed) — runs pre-submit
 *     and again at publish time.
 *  2. LLM review (OpenAI-compatible endpoint, configurable prompt) when
 *     reviewMode = "llm".
 *  3. Manual review queue when reviewMode = "manual" or LLM flags content.
 * Emits moderation events; notifications/rejections flow from there.
 */
export interface KeywordHit {
  word: string;
  severity: "block" | "warn";
}

export async function scanKeywords(text: string): Promise<KeywordHit[]> {
  const rows = await db.select().from(keywords);
  if (!rows.length) return [];
  const lower = text.toLowerCase();
  const hits: KeywordHit[] = [];
  for (const row of rows) {
    const w = row.word.toLowerCase().trim();
    if (w && lower.includes(w)) hits.push({ word: row.word, severity: row.severity });
  }
  return hits;
}

export interface LlmReviewResult {
  approved: boolean;
  score?: number;
  reason?: string;
}

export async function llmReview(text: string): Promise<LlmReviewResult | null> {
  const cfg = await getSetting("moderation.llm");
  if (!cfg.apiKey) return null;
  try {
    const content = await llmChat({
      messages: [
        { role: "system", content: cfg.prompt },
        { role: "user", content: `请审核以下内容并只返回 JSON：\n\n${text.slice(0, 8000)}` },
      ],
      model: cfg.model,
      temperature: cfg.temperature,
      json: true,
    });
    const parsed = JSON.parse(content || "{}") as LlmReviewResult;
    return {
      approved: Boolean(parsed.approved),
      score: parsed.score,
      reason: parsed.reason,
    };
  } catch (err) {
    console.error("[moderation] llm review failed:", err);
    return null;
  }
}

export interface ReviewOutcome {
  status: "published" | "pending_review" | "rejected";
  keywordHits: KeywordHit[];
  llm?: LlmReviewResult | null;
  reason?: string;
}

/** Full pipeline for a post being submitted for publication. */
export async function reviewPost(post: Post): Promise<ReviewOutcome> {
  const reviewMode = await getSetting("moderation.reviewMode");
  const keywordsEnabled = await getSetting("moderation.keywordsEnabled");
  const failMode = await getSetting("moderation.llmFailMode");
  const text = `${post.title ?? ""}\n${post.content}`;

  const keywordHits = keywordsEnabled ? await scanKeywords(text) : [];
  if (keywordHits.some((h) => h.severity === "block")) {
    await finish(post.id, "rejected", keywordHits, null, "包含被禁止的关键词 / contains blocked keywords", "keyword");
    return { status: "rejected", keywordHits, reason: "包含被禁止的关键词 / blocked keywords detected" };
  }

  const warned = keywordHits.length > 0;
  let llm: LlmReviewResult | null = null;

  if (reviewMode === "llm" && !warned) {
    llm = await llmReview(markdownToPlain(post.content).slice(0, 8000) || (post.title ?? ""));
    if (!llm) {
      // provider failure → fail-open or fail-closed per settings
      if (failMode === "closed") {
        await finish(post.id, "pending_review", keywordHits, llm, "LLM 审核暂时不可用", "llm");
        return { status: "pending_review", keywordHits, llm };
      }
    } else if (!llm.approved) {
      await finish(post.id, "rejected", keywordHits, llm, llm.reason ?? "LLM 审核未通过", "llm");
      return { status: "rejected", keywordHits, llm, reason: llm.reason };
    }
  }

  if (reviewMode === "manual" || warned || (reviewMode === "llm" && !llm)) {
    await finish(post.id, "pending_review", keywordHits, llm, warned ? "命中警告关键词，转人工审核" : undefined, "manual");
    return { status: "pending_review", keywordHits, llm };
  }

  // approved → publish
  await db
    .update(posts)
    .set({
      status: "published",
      publishedAt: new Date(),
      moderation: {
        keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
        llm: llm ?? undefined,
        reviewedAt: new Date().toISOString(),
      },
    })
    .where(eq(posts.id, post.id));
  await emit("moderation:review.completed", { postId: post.id, approved: true, by: reviewMode === "llm" ? "llm" : "keyword" });
  return { status: "published", keywordHits, llm };
}

async function finish(
  postId: string,
  status: "pending_review" | "rejected",
  keywordHits: KeywordHit[],
  llm: LlmReviewResult | null,
  reason: string | undefined,
  by: "keyword" | "llm" | "manual",
) {
  await db
    .update(posts)
    .set({
      status,
      rejectReason: status === "rejected" ? (reason ?? null) : null,
      moderation: {
        keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
        llm: llm ?? undefined,
        reviewedAt: new Date().toISOString(),
        reviewedBy: by,
      },
    })
    .where(eq(posts.id, postId));
  if (status === "rejected") {
    const [row] = await db
      .select({ authorId: posts.authorId, title: posts.title, publicId: posts.publicId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (row) {
      await emit("moderation:review.completed", { postId, approved: false, by, reason });
    }
  }
}

/** Pre-submit check used by the editor API (soft feedback to the author). */
export async function preSubmitCheck(title: string, content: string) {
  const keywordsEnabled = await getSetting("moderation.keywordsEnabled");
  if (!keywordsEnabled) return { blocked: [] as string[], warned: [] as string[] };
  const hits = await scanKeywords(`${title}\n${content}`);
  return {
    blocked: hits.filter((h) => h.severity === "block").map((h) => h.word),
    warned: hits.filter((h) => h.severity === "warn").map((h) => h.word),
  };
}

export async function pendingReviewCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(posts)
    .where(eq(posts.status, "pending_review"));
  return n;
}
