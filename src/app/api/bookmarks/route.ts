import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getInteractablePost } from "@/lib/interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ postId: z.string().uuid() });

/** POST /api/bookmarks — toggle bookmarking a post. → { bookmarked } */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    // 桶 action.social：per-user 默认 60 次/60s，覆盖 toggle 高频场景
    await rateLimitBucket("action.social", auth.user.id);

    // 已收藏的帖放行，保证作者收紧可见性后用户仍能撤销
    const existingBookmark = async () => {
      const [row] = await db
        .select({ x: bookmarks.userId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, auth.user.id), eq(bookmarks.postId, parsed.data.postId)))
        .limit(1);
      return Boolean(row);
    };
    const post = await getInteractablePost(parsed.data.postId, auth.user.id, {
      allowExisting: existingBookmark,
    });

    const removed = await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, auth.user.id), eq(bookmarks.postId, post.id)))
      .returning({ id: bookmarks.id });

    if (removed.length > 0) return ok({ bookmarked: false });

    await db
      .insert(bookmarks)
      .values({ userId: auth.user.id, postId: post.id })
      .onConflictDoNothing();
    return ok({ bookmarked: true });
  });
}

/** GET /api/bookmarks?postId= — 当前用户对该帖的收藏状态 → { bookmarked } */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const postId = new URL(req.url).searchParams.get("postId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(postId)) {
      throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    }
    const [row] = await db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, auth.user.id), eq(bookmarks.postId, postId)))
      .limit(1);
    return ok({ bookmarked: row ? true : false });
  });
}
