import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { AppError } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { blockedResponse, getAuthorPost, parseWith, runSubmitCheck } from "../../_shared";

/**
 * POST /api/posts/[id]/submit — author only; submit a draft (or rejected post)
 * for publication. Same flow as action:'submit': hard keyword check →
 * pending_review → emit post:submitted (moderation plugin takes it from there).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(z.uuid(), id);
    // 桶 write.post：per-user 默认 10 次/小时，与发帖共用额度
    await rateLimitBucket("write.post", auth.user.id);
    const post = await getAuthorPost(id, auth.user.id);

    if (post.status === "published") {
      throw new AppError("内容已发布 / Already published", 409, "already_published");
    }

    const result = await runSubmitCheck(post);
    if (!result.submitted) return blockedResponse(result.blocked);

    const [updated] = await db.select().from(posts).where(eq(posts.id, post.id)).limit(1);
    return ok(updated ?? { ...post, status: "pending_review" });
  });
}
