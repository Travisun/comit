import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { getTrendingPosts, toFeedItemDTO, type HotRange } from "@/components/user-space/queries";
import { HotStream } from "@/components/user-space/hot-stream";
import { TimelineHeader } from "@/components/site-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: routes.hot },
  title: "热门",
};

const RANGES: readonly HotRange[] = ["day", "week", "month"];

/**
 * 「热门」榜（左侧菜单第二项直达）：今日/本周/本月三个时间窗，
 * 排名算法见 queries.getTrendingPosts（时间窗互动加权 + 新鲜度重力衰减）。
 */
export default async function HotPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range: HotRange = RANGES.includes(rawRange as HotRange) ? (rawRange as HotRange) : "day";

  const [viewer, { locale }] = await Promise.all([getCurrentUser(), getT()]);
  const feed = await getTrendingPosts({ range, limit: 10, viewerId: viewer?.id ?? null });

  return (
    <div className="min-h-dvh w-full pt-[10px]">
      <TimelineHeader
        title={locale === "zh" ? "热门" : "Trending"}
        subtitle={
          locale === "zh" ? "按时间窗内的互动热度排序" : "Ranked by engagement within the window"
        }
        paddingClass="px-5"
      />

      <HotStream
        initialItems={feed.items.map(toFeedItemDTO)}
        initialCursor={feed.nextOffset}
        initialRange={range}
        viewerUsername={viewer?.username}
        locale={locale}
      />
    </div>
  );
}
