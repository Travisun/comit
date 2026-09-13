import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { postReactions, posts } from "@/db/schema";
import { AppError, notFound } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});

type Ctx = { params: Promise<{ id: string }> };

/** Aggregate one post's reactions in JS — volumes per post are tiny. */
async function summary(postId: string, viewerId: string | null) {
  const rows = await db
    .select({ emoji: postReactions.emoji, userId: postReactions.userId })
    .from(postReactions)
    .where(eq(postReactions.postId, postId));
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const entry = map.get(r.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (viewerId && r.userId === viewerId) entry.mine = true;
    map.set(r.emoji, entry);
  }
  return [...map.entries()]
    .map(([emoji, v]) => ({ emoji, ...v }))
    .sort((a, b) => b.count - a.count);
}

/** GET /api/posts/[id]/reactions — reaction summary (+ viewer state, anonymous ok). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const viewer = await getCurrentUser().catch(() => null);
  return ok({ items: await summary(id, viewer?.id ?? null), signedIn: Boolean(viewer) });
}

/** POST /api/posts/[id]/reactions — toggle the viewer's reaction { emoji }. */
export async function POST(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id: postId } = await ctx.params;
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { emoji } = parsed.data;

    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) throw notFound("内容不存在 / Post not found");

    const removed = await db
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.userId, auth.user.id),
          eq(postReactions.postId, postId),
          eq(postReactions.emoji, emoji),
        ),
      )
      .returning({ id: postReactions.id });

    if (removed.length === 0) {
      await db
        .insert(postReactions)
        .values({ userId: auth.user.id, postId, emoji })
        .onConflictDoNothing();
    }

    return ok({ items: await summary(postId, auth.user.id), signedIn: true });
  });
}
