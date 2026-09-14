import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { notFound } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { parseWith } from "../../_shared";

export const runtime = "nodejs";

const idSchema = z.uuid();

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/posts/[id]/restore — bring a recycle-bin post back to its
 * previous lifecycle state (deleted posts restore as drafts). */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseWith(idSchema, id);
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, auth.user.id), eq(posts.status, "deleted")))
      .limit(1);
    if (!post) throw notFound("回收站中没有这篇文章 / Not in the recycle bin");

    const restored = await db
      .update(posts)
      .set({
        status: (post.preDeleteStatus as "draft") ?? "draft",
        preDeleteStatus: null,
        deletedAt: null,
      })
      .where(and(eq(posts.id, post.id), eq(posts.authorId, auth.user.id)))
      .returning({ id: posts.id, status: posts.status });
    return ok(restored[0]);
  });
}
