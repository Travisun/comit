"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { feedPageSchema } from "@/lib/models/feed";
import { ArticleCard, FEED_ROW_CLASS } from "./article-card";
import { ShortCard } from "./short-card";
import { ListSkeleton } from "./list-skeleton";
import type { FeedItemDTO } from "./types";

/**
 * Mixed article/short stream with IntersectionObserver "load more".
 * 分页由 useInfiniteQuery 管理：服务端首屏数据作为 initialData 第一页，
 * 后续页按 cursor 递增拉取；跨页去重交给 items 聚合处的 seen 集合。
 */
export function FeedStream({
  initialItems,
  initialCursor,
  emptyText = "还没有动态，关注一些人或发布第一条动态吧。",
  viewerUsername,
  scope,
}: {
  initialItems: FeedItemDTO[];
  initialCursor: number | null;
  emptyText?: string;
  /** signed-in viewer — enables inline edit / delete on own posts */
  viewerUsername?: string;
  /** feed scope: "following" 只加载关注作者的动态 */
  scope?: "following";
}) {
  const feedUrl = (cursor: number) =>
    `/api/feed?cursor=${cursor}${scope === "following" ? "&scope=following" : ""}`;

  const query = useInfiniteQuery({
    queryKey: queryKeys.feed(scope),
    queryFn: async ({ pageParam }) => feedPageSchema.parse(await apiGet<unknown>(feedUrl(pageParam))),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    // 服务端渲染的首屏数据作为第一页，挂载不重复请求
    initialData: {
      pages: [{ items: initialItems, nextOffset: initialCursor }],
      pageParams: [0],
    },
    staleTime: 15_000,
  });

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

  // ---- auto-refresh: 新帖横幅 — 轻量探测首页（30s 轮询，后台标签页暂停） ----
  // newCount 由探测结果与已取页的差集派生；翻页不再重建轮询
  // （旧 useEffect([items]) 手写 interval 的问题随声明式 refetchInterval 自然消失）
  const checkQ = useQuery({
    queryKey: queryKeys.feedCheck(scope),
    queryFn: async () => feedPageSchema.parse(await apiGet<unknown>(feedUrl(0))),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const newCount = useMemo(() => {
    const latest = checkQ.data?.items;
    if (!latest) return 0;
    const seen = new Set(items.map((i) => i.post.id));
    return latest.filter((i) => !seen.has(i.post.id)).length;
  }, [checkQ.data, items]);

  const loadNew = () => {
    // 重拉已取回的所有页：新帖自然排到最前，游标状态保持一致；横幅计数随
    // items 更新自动归零，无需手动清零。
    // 取舍：深翻页后 refetch 会按游标重放所有页请求（网络放大）；setQueryData
    // 前插需要重排各页的 offset 游标一致性，当前页深下成本大于收益，保留 refetch。
    void query.refetch();
  };

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
  }, [query.hasNextPage, fetchNextPage]);

  if (items.length === 0) {
    return (
      <div className="px-5 py-14 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  /* 最新/关注流的行样式与个人主页/发现页共用 FEED_ROW_CLASS：
     1px 分割线 + 左右 20px 内边距；隐藏内容标注 chip，整行点击进详情。 */
  const rowClass = FEED_ROW_CLASS;

  return (
    <div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={loadNew}
          className="sticky top-12 z-20 flex w-full items-center justify-center gap-1.5 border-b border-border bg-[var(--primary)] py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <span className="num font-semibold">{newCount}</span> 条新动态 · 点击查看
        </button>
      )}
      {items.map((item) =>
        item.post.type === "short" ? (
          <ShortCard
            key={item.post.id}
            post={item.post}
            author={item.author}
            viewerUsername={viewerUsername}
            className={rowClass}
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
            className={rowClass}
            showLabel={false}
            rowHref
            menu={Boolean(viewerUsername)}
          />
        ),
      )}
      {query.isFetchingNextPage && <ListSkeleton rows={2} />}
      {query.hasNextPage ? (
        <div ref={sentinelRef} className="h-4" aria-hidden />
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">已经到底啦</p>
      )}
    </div>
  );
}
