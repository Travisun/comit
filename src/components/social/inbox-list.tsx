"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Bell, Loader2, SquarePen } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { apiGet, mediaUrl, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import { useRealtime } from "@/lib/client/realtime";
import { Button } from "@/components/ui/button";
import {
  conversationSchema,
  notificationSchema,
  allowedUserSchema,
  type NotificationItem,
} from "@/lib/models/messages";

/**
 * Unified message stream — the left pane of the inbox. DM conversations and
 * system notifications (抽象为"系统发给用户的消息") merge into one
 * time-sorted stream. The header carries the 新私信 people picker (mutual
 * follows with DMs enabled) and 全部已读 for notifications.
 */

interface InboxRow {
  key: string;
  kind: "dm" | "system";
  displayName: string;
  avatarPath: string | null;
  preview: string;
  time: string | null;
  unread: number;
  bold: boolean;
  dmUserId?: string;
  notification?: NotificationItem;
}

export function InboxList({ selectedUserId }: { selectedUserId?: string }) {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale === "zh";
  const queryClient = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);

  const conversationsQ = useQuery({
    queryKey: queryKeys.conversations(),
    queryFn: async () =>
      conversationSchema.array().parse(await apiGet<unknown>("/api/messages/conversations")),
  });
  const notificationsQ = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: async () =>
      z
        .object({ items: z.array(notificationSchema) })
        .parse(await apiGet<unknown>("/api/notifications")).items,
  });

  // eslint: 包一层 useMemo，稳定 rows 依赖（同 post-tree 的 data ?? [] 模式）
  const convs = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const notifs = useMemo(() => notificationsQ.data ?? [], [notificationsQ.data]);
  const loaded = !conversationsQ.isLoading && !notificationsQ.isLoading;

  // 新私信 people picker — 打开时才拉取（enabled 条件查询）
  const allowedQ = useQuery({
    queryKey: queryKeys.allowedDmUsers(),
    queryFn: async () =>
      z
        .object({ items: allowedUserSchema.array() })
        .parse(await apiGet<unknown>("/api/messages/allowed")).items,
    enabled: composeOpen,
    staleTime: 60_000,
  });
  const allowed = allowedQ.data;

  const rows = useMemo<InboxRow[]>(() => {
    const out: InboxRow[] = [];
    for (const c of convs) {
      out.push({
        key: `dm-${c.userId}`,
        kind: "dm",
        displayName: c.displayName,
        avatarPath: c.avatarPath,
        preview: c.lastMessage
          ? `${c.lastMessage.mine ? (zh ? "我: " : "You: ") : ""}${c.lastMessage.body}`
          : `@${c.username}`,
        time: c.lastMessage?.createdAt ?? null,
        unread: c.unread,
        bold: c.unread > 0,
        dmUserId: c.userId,
      });
    }
    for (const n of notifs) {
      out.push({
        key: `ntf-${n.id}`,
        kind: "system",
        displayName: n.title,
        avatarPath: n.actor?.avatarPath ?? null,
        preview: n.body ?? "",
        time: n.createdAt,
        unread: n.readAt ? 0 : 1,
        bold: !n.readAt,
        notification: n,
      });
    }
    return out.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
  }, [convs, notifs, zh]);

  const unreadNotifs = notifs.filter((n) => !n.readAt).length;

  // 实时接入（单例 SSE 总线）：新消息 / 已读回执 / 断线重连都会改变会话
  // 预览与未读 → 失效会话列表。通知列表与角标由 use-local-unread 的全局
  // 订阅负责，这里不重复。
  useRealtime((event) => {
    if (
      event.type === "message.created" ||
      event.type === "message.read" ||
      event.type === "realtime.reconnected"
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations() });
    }
  });

  // 全部已读（mutation 收编）：optimistic 先把列表置已读（失败自动回滚
  // 快照），静默提交不打扰；成功后失效角标查询，顶部铃铛才会归零。
  const markAllReadMutation = useApiMutation(
    () => postJson("/api/notifications/read-all", {}),
    {
      silent: true,
      refresh: false, // 列表/角标均为查询缓存数据，无需 RSC 重验
      optimistic: {
        queryKey: queryKeys.notifications(),
        apply: (prev) =>
          prev === undefined
            ? prev
            : (prev as NotificationItem[]).map((n) => ({
                ...n,
                readAt: n.readAt ?? new Date().toISOString(),
              })),
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationBadge() });
      },
    },
  );

  /** system rows: mark read, then navigate to the notification's target */
  const markOneReadMutation = useApiMutation(
    (id: string) => postJson("/api/notifications/read", { id }),
    {
      silent: true,
      refresh: false,
      optimistic: {
        queryKey: queryKeys.notifications(),
        apply: (prev, id) =>
          prev === undefined
            ? prev
            : (prev as NotificationItem[]).map((x) =>
                x.id === id ? { ...x, readAt: x.readAt ?? new Date().toISOString() } : x,
              ),
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationBadge() });
      },
    },
  );

  function markAllRead() {
    void markAllReadMutation.mutate(undefined);
  }

  const [expandedId, setExpandedId] = useState<string | null>(null);

  /** 两步交互：点击 = 标已读 + 展开/收起摘要详情（不立即跳转）；展开后点链接才跳 */
  function openSystem(n: NotificationItem) {
    if (!n.readAt) void markOneReadMutation.mutate(n.id);
    setExpandedId((prev) => (prev === n.id ? null : n.id));
  }

  function pick(uid: string) {
    setComposeOpen(false);
    router.push(`/messages/${uid}`);
  }

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-3 pr-2">
        <h2 className="text-[15px] font-normal">{zh ? "消息" : "Messages"}</h2>
        <div className="flex items-center gap-1">
          {unreadNotifs > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
            >
              {zh ? "全部已读" : "Mark all read"}
            </button>
          )}
          <button
            type="button"
            aria-label={zh ? "新私信" : "New DM"}
            title={zh ? "新私信（互相关注的人）" : "New DM (mutual follows)"}
            onClick={() => setComposeOpen((v) => !v)}
            className={cn(
              "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground",
              composeOpen && "bg-[var(--selected)] text-foreground",
            )}
          >
            <SquarePen className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* 新私信 people picker */}
      {composeOpen && (
        <div className="shrink-0 border-b border-border">
          {allowedQ.isPending ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : allowed !== undefined && allowed.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto py-1">
              {allowed.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--hover)]"
                  >
                    <Avatar className="size-8">
                      {u.avatarPath && <AvatarImage src={mediaUrl(u.avatarPath)} alt={u.displayName} />}
                      <AvatarFallback>{u.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{u.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{u.username}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {zh
                ? "互相关注后即可私信。去发现页找到感兴趣的人吧。"
                : "Follow each other to DM. Find people in Discover."}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {!loaded ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{zh ? "暂无消息" : "No messages yet"}</p>
        ) : (
          <ul>
            {rows.map((row) => {
              const inner = (
                <>
                  {row.kind === "dm" ? (
                    <Avatar className="size-10">
                      {row.avatarPath && (
                        <AvatarImage src={mediaUrl(row.avatarPath)} alt={row.displayName} />
                      )}
                      <AvatarFallback>{row.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Bell className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm text-foreground", row.bold && "font-semibold")}>
                        {row.displayName}
                      </span>
                      {row.time && (
                        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(row.time, locale)}</span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{row.preview}</span>
                      {row.unread > 0 && (
                        <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums">
                          {row.unread > 99 ? "99+" : row.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </>
              );

              const cls = cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--hover)]",
                row.bold && "bg-primary/5",
                selectedUserId && row.dmUserId === selectedUserId && "bg-[var(--selected)]",
              );

              return (
                <li key={row.key} className="border-b border-border last:border-b-0">
                  {row.kind === "dm" ? (
                    <Link href={`/messages/${row.dmUserId}`} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <div className="w-full">
                      <button
                        type="button"
                        onClick={() => openSystem(row.notification!)}
                        className={cn(cls, "w-full cursor-pointer")}
                      >
                        {inner}
                        {!row.notification!.readAt && (
                          <span className="ml-auto inline-block size-2 shrink-0 rounded-full bg-primary" aria-label="未读" />
                        )}
                      </button>
                      {expandedId === row.notification!.id && (
                        <div className="border-t border-border/60 bg-[var(--muted)]/30 px-4 py-3">
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                            {row.notification!.body}
                          </p>
                          {row.notification!.url && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="mt-2 rounded-full"
                              onClick={() => router.push(row.notification!.url!)}
                            >
                              <span>查看详情</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
