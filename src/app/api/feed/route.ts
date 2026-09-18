import { NextRequest, NextResponse } from "next/server";
import { getPublishedPosts, toFeedItemDTO } from "@/components/user-space/queries";
import { getCurrentUser } from "@/lib/auth/session";
import { withApi } from "@/lib/http";

/**
 * GET /api/feed?cursor=<offset> — paginated mixed (article + short) stream
 * for the IntersectionObserver loader on /feed.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  // withApi：同源校验（GET 无操作）+ 维护模式守卫（GET 豁免）+ 错误统一 envelope
  return withApi(req, async () => {
    const raw = Number(new URL(req.url).searchParams.get("cursor") ?? "0");
    const cursor = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

    // scope=following → 只看关注作者的流（需登录）；scope=latest 公共流匿名照常可看。
    // viewer 恒解析：登录用户的行内收藏按钮需要 bookmarked 初始状态
    const scope = new URL(req.url).searchParams.get("scope");
    const viewer = await getCurrentUser().catch(() => null);

    // 匿名请求 following 流：与注释语义一致，返回空流而不是回落公共流
    if (scope === "following" && !viewer) {
      return NextResponse.json(
        { items: [], nextOffset: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { items, nextOffset } = await getPublishedPosts({
      limit: PAGE_SIZE,
      offset: cursor,
      viewerId: viewer?.id,
      ...(scope === "following" && viewer ? { followingOf: viewer.id } : {}),
    });

    return NextResponse.json(
      { items: items.map(toFeedItemDTO), nextOffset },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
