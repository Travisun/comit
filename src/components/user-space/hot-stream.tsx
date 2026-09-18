"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { feedPageSchema } from "@/lib/models/feed";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { ArticleCard, FEED_ROW_CLASS } from "./article-card";
import { ShortCard } from "./short-card";
import { ListSkeleton } from "./list-skeleton";
import type { HotRange } from "./queries";
import type { FeedItemDTO } from "./types";

const RANGES: { id: HotRange; zh: string; en: string }[] = [
  { id: "day", zh: "今日", en: "Today" },
  { id: "week", zh: "本周", en: "This week" },
  { id: "month", zh: "本月", en: "This month" },
];

function isHotRange(v: string): v is HotRange {
  return v === "day" || v === "week" || v === "month";
}

/**
 * 热门榜流：今日/本周/本月三个时间窗，Tab 客户端切换（榜单数据轻，
 * 切窗直接拉 /api/hot，不走服务端重渲染）；IntersectionObserver 续拉。
 * 与 FeedStream 不同：榜单随互动实时变化，不做「新动态」轮询横幅，
 * 避免排名跳变；重新进页/切 Tab 即拿到最新榜单（服务端另有 30s 排名缓存）。
 */
export function HotStream({
  initialItems,
  initialCursor,
  initialRange,
  viewerUsername,
  locale,
}: {
  initialItems: FeedItemDTO[];
  initialCursor: number | null;
  initialRange: HotRange;
  /** signed-in viewer — enables inline edit / delete on own posts */
  viewerUsername?: string;
  locale: "zh" | "en";
}) {
  const [range, setRange] = useState<HotRange>(initialRange);

  const query = useInfiniteQuery({
    queryKey: queryKeys.hot(range),
    queryFn: async ({ pageParam }) =>
      feedPageSchema.parse(await apiGet<unknown>(`/api/hot?range=${range}&cursor=${pageParam}`)),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    // 服务端渲染的首屏（当前 range）作为第一页；切换到其他 range 走网络
    ...(range === initialRange
      ? {
          initialData: {
            pages: [{ items: initialItems, nextOffset: initialCursor }],
            pageParams: [0],
          },
        }
      : {}),
    staleTime: 15_000,
  });

  function switchRange(next: string) {
    if (!isHotRange(next) || next === range) return;
    setRange(next);
    // URL 同步（可分享/可回退到具体榜单），不触发服务端重渲染
    window.history.replaceState(null, "", next === "day" ? "/hot" : `/hot?range=${next}`);
  }

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedItemDTO[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (!seen.has(item.post.id)) {
          seen.add(item.post.id);
          out.push(item);
        }
      }
    }
    return out;
  }, [query.data]);

  // ---- IntersectionObserver "load more" ----
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchNextPage = query.fetchNextPage;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !query.hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, fetchNextPage, range]);

  const loading = !query.data;

  return (
    <div>
      <div className="sticky top-12 z-30 bg-card/80 backdrop-blur-md md:top-0">
        <Tabs value={range} onValueChange={switchRange} className="px-5">
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {locale === "zh" ? r.zh : r.en}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-muted-foreground">
          {locale === "zh"
            ? "这个时间窗内还没有热门内容，去发布第一条动态点燃榜单吧。"
            : "Nothing trending in this window yet — publish something to spark the board."}
        </div>
      ) : (
        items.map((item) =>
          item.post.type === "short" ? (
            <ShortCard
              key={item.post.id}
              post={item.post}
              author={item.author}
              viewerUsername={viewerUsername}
              className={FEED_ROW_CLASS}
              showLabel={false}
              rowHref
              menu={Boolean(viewerUsername)}
            />
          ) : (
            <ArticleCard
              key={item.post.id}
              post={item.post}
              author={item.author}
              variant="list"
              viewerUsername={viewerUsername}
              className={FEED_ROW_CLASS}
              showLabel={false}
              rowHref
              menu={Boolean(viewerUsername)}
            />
          ),
        )
      )}
      {query.isFetchingNextPage && <ListSkeleton rows={2} />}
      {!loading && query.hasNextPage && <div ref={sentinelRef} className="h-4" aria-hidden />}
      {!loading && !query.hasNextPage && items.length > 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">已经到底啦</p>
      )}
    </div>
  );
}
