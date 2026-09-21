"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, Bot, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { apiGet, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import { useRealtime } from "@/lib/client/realtime";
import { notificationSchema, type NotificationItem } from "@/lib/models/messages";
import { mentionSyntaxToPlainText } from "@/lib/mention-syntax";

/**
 * System 会话（右侧聊天窗）：系统通知抽象为「System 官方账号」发来的私信 —
 * 单向服务消息（不可回复），点击带链接的气泡 = 标已读 + 跳转目标。
 * 打开会话即视为已读（聊天语义，与 DM 一致），回写后左栏未读徽标与
 * 顶部铃铛同步归零。
 */

const pageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unread: z.number(),
});
type NotifPage = z.infer<typeof pageSchema>;

const PAGE_SIZE = 30;

type NotifCache = InfiniteData<NotifPage>;

function mapPages(cache: NotifCache, fn: (n: NotificationItem) => NotificationItem): NotifCache {
  return {
    ...cache,
    pages: cache.pages.map((p) => ({
      ...p,
      items: p.items.map(fn),
      unread: 0,
    })),
  };
}

export function SystemChat() {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale === "zh";
  const queryClient = useQueryClient();
  /** 打开即已读只做一次（避免数据刷新反复触发回写） */
  const autoReadRef = useRef(false);

  const notifsQ = useInfiniteQuery({
    queryKey: queryKeys.notificationsInfinite(),
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) qs.set("cursor", String(pageParam));
      return pageSchema.parse(await apiGet<unknown>(`/api/notifications?${qs.toString()}`));
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = useMemo(() => notifsQ.data?.pages.flatMap((p) => p.items) ?? [], [notifsQ.data]);
  const unread = notifsQ.data?.pages[0]?.unread ?? 0;

  // 单条已读 / 全部已读：乐观改无限流缓存，成功后刷新角标与左栏预览
  const markOneReadMutation = useApiMutation(
    (id: string) => postJson("/api/notifications/read", { id }),
    {
      silent: true,
      refresh: false,
      optimistic: {
        queryKey: queryKeys.notificationsInfinite(),
        apply: (prev, id) =>
          prev === undefined
            ? prev
            : mapPages(prev as NotifCache, (n) =>
                n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
              ),
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationBadge() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsPreview() });
      },
    },
  );

  const markAllReadMutation = useApiMutation(
    () => postJson("/api/notifications/read-all", {}),
    {
      silent: true,
      refresh: false,
      optimistic: {
        queryKey: queryKeys.notificationsInfinite(),
        apply: (prev) =>
          prev === undefined
            ? prev
            : mapPages(prev as NotifCache, (n) => ({
                ...n,
                readAt: n.readAt ?? new Date().toISOString(),
              })),
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationBadge() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsPreview() });
      },
    },
  );

  // 打开会话即视为已读（一次性）：有未读时静默回写
  useEffect(() => {
    if (autoReadRef.current || notifsQ.data === undefined) return;
    autoReadRef.current = true;
    if (unread > 0) void markAllReadMutation.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifsQ.data]);

  // 实时：新通知/断线重连 → 刷新本窗与左栏 System 会话预览
  useRealtime((event) => {
    if (event.type === "notification.created" || event.type === "realtime.reconnected") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsInfinite() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsPreview() });
    }
  });

  /** 点气泡：有链接 → 标已读 + 跳转；无链接 → 仅标已读 */
  function open(n: NotificationItem) {
    if (!n.readAt) void markOneReadMutation.mutate(n.id);
    if (n.url) router.push(n.url);
  }

  return (
    <div className="flex h-full flex-col">
      {/* header — 与 ChatClient 同款聊天窗头 */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => router.push("/messages")}
          aria-label={zh ? "返回" : "Back"}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-primary/10 text-primary">
            <Bot className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">System</span>
            <span className="block truncate text-xs text-muted-foreground">
              {zh ? "官方账号 · 系统通知" : "Official account · System notices"}
            </span>
          </span>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllReadMutation.mutate(undefined)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
          >
            <CheckCheck className="size-3.5" aria-hidden />
            {zh ? "全部已读" : "Mark all read"}
          </button>
        )}
      </div>

      {/* messages — 新通知在上（服务号消息流），向下加载更早 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6">
        {notifsQ.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-end gap-2">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-16 w-2/3 rounded-2xl sm:w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <span className="grid size-10 place-items-center rounded-full bg-[var(--muted)]">
              <Bot className="size-4" aria-hidden />
            </span>
            <p className="text-sm">{zh ? "暂无系统通知" : "No system notices yet"}</p>
          </div>
        ) : (
          <>
            {items.map((n) => (
              <div key={n.id} className="flex items-end gap-2 justify-start">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-primary/10 text-primary">
                  <Bot className="size-3.5" aria-hidden />
                </span>
                <div
                  role={n.url ? "button" : undefined}
                  tabIndex={n.url ? 0 : undefined}
                  onClick={n.url ? () => open(n) : undefined}
                  onKeyDown={
                    n.url
                      ? (e) => {
                          if (e.key === "Enter") open(n);
                        }
                      : undefined
                  }
                  className={cn(
                    "max-w-[78%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm leading-relaxed sm:max-w-[65%]",
                    n.url && "cursor-pointer transition-colors hover:bg-[var(--selected)]",
                  )}
                >
                  {/* 历史通知行仍带 mention 引用语法（写入端修复前落的库）：
                      展示前拉平为 @昵称，气泡里绝不漏语法字面量 */}
                  <p className="font-medium text-foreground">{n.title}</p>
                  {n.body && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
                      {mentionSyntaxToPlainText(n.body)}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <time dateTime={n.createdAt}>{timeAgo(n.createdAt, locale)}</time>
                    {n.url && (
                      <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                        <ExternalLink className="size-2.5" aria-hidden />
                        {zh ? "查看详情" : "Open"}
                      </span>
                    )}
                    {!n.readAt && (
                      <span className="size-1.5 rounded-full bg-primary" aria-label={zh ? "未读" : "Unread"} />
                    )}
                  </p>
                </div>
              </div>
            ))}
            {notifsQ.hasNextPage && (
              <div className="flex justify-center pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void notifsQ.fetchNextPage()}
                  disabled={notifsQ.isFetchingNextPage}
                >
                  {notifsQ.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
                  {zh ? "加载更早的通知" : "Load earlier"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 单向服务消息：无回复框 — 底部说明条占位，保持聊天窗视觉重心 */}
      <div className="shrink-0 border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
        {zh ? "系统通知为单向服务消息，不支持回复" : "System notices are one-way; replies are disabled"}
      </div>
    </div>
  );
}
