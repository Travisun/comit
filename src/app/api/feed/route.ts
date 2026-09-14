import { NextRequest, NextResponse } from "next/server";
import { getPublishedPosts, toFeedItemDTO } from "@/components/user-space/queries";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * GET /api/feed?cursor=<offset> — paginated mixed (article + short) stream
 * for the IntersectionObserver loader on /feed.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const raw = Number(new URL(req.url).searchParams.get("cursor") ?? "0");
  const cursor = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

  // scope=following → 只看关注作者的流（需登录；匿名返回空流）
  const scope = new URL(req.url).searchParams.get("scope");
  const viewer = scope === "following" ? await getCurrentUser().catch(() => null) : null;

  const { items, nextOffset } = await getPublishedPosts({
    limit: PAGE_SIZE,
    offset: cursor,
    ...(viewer ? { followingOf: viewer.id } : {}),
  });

  return NextResponse.json(
    { items: items.map(toFeedItemDTO), nextOffset },
    { headers: { "Cache-Control": "no-store" } },
  );
}
