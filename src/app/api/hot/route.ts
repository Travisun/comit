import { NextRequest, NextResponse } from "next/server";
import { getTrendingPosts, toFeedItemDTO, type HotRange } from "@/components/user-space/queries";
import { getCurrentUser } from "@/lib/auth/session";
import { withApi } from "@/lib/http";

/**
 * GET /api/hot?range=day|week|month&cursor=<offset> — 热门榜无限流
 * （时间窗互动加权 + 新鲜度重力衰减，算法见 queries.getTrendingPosts）。
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const RANGES: readonly HotRange[] = ["day", "week", "month"];

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const params = new URL(req.url).searchParams;
    const rawRange = params.get("range") ?? "day";
    const range: HotRange = (RANGES as readonly string[]).includes(rawRange)
      ? (rawRange as HotRange)
      : "day";
    const raw = Number(params.get("cursor") ?? "0");
    const cursor = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

    // viewer 恒解析：登录用户的行内收藏按钮需要 bookmarked 初始状态
    const viewer = await getCurrentUser().catch(() => null);

    const { items, nextOffset } = await getTrendingPosts({
      range,
      limit: PAGE_SIZE,
      offset: cursor,
      viewerId: viewer?.id,
    });

    return NextResponse.json(
      { items: items.map(toFeedItemDTO), nextOffset },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
