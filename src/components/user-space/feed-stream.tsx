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
}: {
  initialItems: FeedItemDTO[];
  initialCursor: number | null;
  emptyText?: string;
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
      const res = await fetch(`/api/feed?cursor=${c}`);
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
  }, []);

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

  if (items.length === 0) {
    return (
      <div className="px-6 py-14 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div>
      {items.map((item) =>
        item.post.type === "short" ? (
          <ShortCard key={item.post.id} post={item.post} author={item.author} />
        ) : (
          <ArticleCard key={item.post.id} post={item.post} author={item.author} variant="list" />
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
