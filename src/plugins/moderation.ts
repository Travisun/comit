import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { queue } from "@/core/queue";
import { emit } from "@/core/events";
import { reviewPost } from "@/lib/moderation";
import { getSetting } from "@/lib/settings";
import type { Plugin } from "@/core/plugins/types";

/**
 * Moderation plugin — listens for submissions and runs the keyword/LLM
 * pipeline asynchronously through the queue so publishing stays snappy.
 */
const plugin: Plugin = {
  name: "moderation",
  description: "Keyword + LLM content review pipeline",
  version: "1.0.0",
  register(ctx) {
    ctx.events.on("post:submitted", async (payload) => {
      const reviewMode = await getSetting("moderation.reviewMode");
      if (reviewMode === "off") {
        // no review: publish immediately
        await db
          .update(posts)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(posts.id, payload.postId));
        const [row] = await db
          .select({ slug: posts.slug, title: posts.title, type: posts.type })
          .from(posts)
          .where(eq(posts.id, payload.postId))
          .limit(1);
        if (row) {
          await emit("post:published", {
            postId: payload.postId,
            authorId: payload.authorId,
            slug: row.slug ?? "",
            title: row.title ?? "",
            type: row.type,
          });
        }
        return;
      }
      await queue.send("moderation.review", { postId: payload.postId }, { retryLimit: 2 });
    });
  },
};

export default plugin;

/** Queue worker entry (invoked by core/workers.ts). */
export async function processModerationJob(postId: string): Promise<void> {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!row || row.status !== "pending_review") return;
  await reviewPost(row);
}
