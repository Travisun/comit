import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts } from "@/db/schema";
import { emit } from "@/core/events";
import { reviewComment, reviewPost } from "@/lib/moderation";
import { getSetting } from "@/lib/settings";
import type { Plugin } from "@/core/plugins/types";

/**
 * Moderation plugin — listens for submissions and runs the keyword/LLM
 * pipeline asynchronously through the queue so publishing stays snappy.
 *
 * 队列任务通过 ctx.jobs.work("review") 自包含注册（ext.job 通道统一消费），
 * payload 支持 { postId }（帖子审核）与 { commentId }（评论审核）。
 */
const plugin: Plugin = {
  name: "moderation",
  description: "Keyword + LLM content review pipeline",
  version: "1.1.0",
  register(ctx) {
    ctx.events.on("post:submitted", async (payload) => {
      const reviewMode = await getSetting("moderation.reviewMode");
      if (reviewMode === "off") {
        // no review: publish immediately
        // 发布前钩子（扩展可拦截发布：合规复核/定时发布/付费墙标记…）
        const publishingCtx = {
          postId: payload.postId,
          authorId: payload.authorId,
          rejection: null as string | null,
          reject(reason: string) {
            publishingCtx.rejection = reason;
          },
        };
        await ctx.hooks.callHook("post:publishing", publishingCtx);
        if (publishingCtx.rejection) {
          console.warn(`[moderation] publish blocked: ${publishingCtx.rejection}`);
          return;
        }
        await db
          .update(posts)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(posts.id, payload.postId));
        const [row] = await db
          .select({ publicId: posts.publicId, title: posts.title, type: posts.type })
          .from(posts)
          .where(eq(posts.id, payload.postId))
          .limit(1);
        if (row) {
          await emit("post:published", {
            postId: payload.postId,
            authorId: payload.authorId,
            publicId: row.publicId,
            title: row.title ?? "",
            type: row.type,
          });
        }
        return;
      }
      await ctx.jobs.dispatch("review", { postId: payload.postId }, { retryLimit: 2 });
    });

    // 审核任务处理器：补齐此前缺失的注册（reviewMode=llm/manual 时任务
    // 入队后无人消费，内容会永久停留在 pending_review）。
    ctx.jobs.work("review", async (payload) => {
      if (typeof payload.commentId === "string") {
        const [row] = await db.select().from(comments).where(eq(comments.id, payload.commentId)).limit(1);
        if (row && row.status === "pending_review") await reviewComment(row);
        return;
      }
      if (typeof payload.postId === "string") {
        const [row] = await db.select().from(posts).where(eq(posts.id, payload.postId)).limit(1);
        if (row && row.status === "pending_review") await reviewPost(row);
      }
    });
  },
};

export default plugin;

/** Queue worker entry — 供脚本/测试直接调用（队列消费走 ctx.jobs.work 注册表）。 */
export async function processModerationJob(postId: string): Promise<void> {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!row || row.status !== "pending_review") return;
  await reviewPost(row);
}

export async function processCommentModerationJob(commentId: string): Promise<void> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!row || row.status !== "pending_review") return;
  await reviewComment(row);
}
