"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArticleCard } from "./article-card";
import { ShortCard } from "./short-card";
import { ListSkeleton } from "./list-skeleton";
import type { FeedItemDTO } from "./types";

/**
 * Mixed article/short stream with IntersectionObserver "load more".
 * Appends pages from GET /api/feed?cursor=<offset> until exhausted.
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
  const [items, setItems] = useState<FeedItemDTO[]>(initialItems);
  const [cursor, setCursor] = useState<number | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<number | null>(initialCursor);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    const c = cursorRef.current;
    if (c === null || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/feed?cursor=${c}${scope === "following" ? "&scope=following" : ""}`);
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { items: FeedItemDTO[]; nextOffset: number | null };
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.post.id));
        return [...prev, ...data.items.filter((i) => !seen.has(i.post.id))];
      });
      cursorRef.current = data.nextOffset;
      setCursor(data.nextOffset);
    } catch {
      // stop trying on failure — cursor nulled to unmount the observer work
      cursorRef.current = null;
      setCursor(null);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cursor === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  // ---- auto-refresh: poll for new posts, show banner ----
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/feed?limit=5${scope === "following" ? "&scope=following" : ""}`);
        if (!r.ok) return;
        const data = (await r.json()) as { items: FeedItemDTO[] };
        const fresh = data.items.filter(
          (i) => !items.some((e) => e.post.id === i.post.id),
        );
        setNewCount(fresh.length);
      } catch { /* silent */ }
    }, 30_000);
    return () => clearInterval(timer);
  }, [items]);

  const loadNew = useCallback(async () => {
    try {
      const r = await fetch(`/api/feed?limit=20${scope === "following" ? "&scope=following" : ""}`);
      if (!r.ok) return;
      const data = (await r.json()) as { items: FeedItemDTO[]; nextOffset: number | null };
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.post.id));
        return [...data.items.filter((i) => !seen.has(i.post.id)), ...prev];
      });
      setNewCount(0);
    } catch { /* silent */ }
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="px-5 py-14 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  /* 最新/关注流的行样式：1px 分割线 + hover 整行融入背景（.feed-row），
     左右 padding 与发现页对齐（px-5），纵向更紧凑；隐藏内容标注 chip，
     整行点击进详情（行内链接/按钮保持自身行为）。 */
  const rowClass = "feed-row px-5 py-2.5";

  return (
    <div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => void loadNew()}
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
      {loading && <ListSkeleton rows={2} />}
      {cursor !== null ? (
        <div ref={sentinelRef} className="h-4" aria-hidden />
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">已经到底啦</p>
      )}
    </div>
  );
}
