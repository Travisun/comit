"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Bot, Loader2, SquarePen } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { apiGet, mediaUrl } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useRealtime } from "@/lib/client/realtime";
import {
  conversationSchema,
  notificationSchema,
  allowedUserSchema,
} from "@/lib/models/messages";
import { mentionSyntaxToPlainText } from "@/lib/mention-syntax";

/**
 * 聊天式左栏 — 纯会话列表（消息发送者视角）：
 *  - 置顶 System 会话：系统通知抽象为官方账号的私信（头像 + 未读徽标 +
 *    最新一条通知预览），点击进入 /messages/system 聊天窗；
 *  - 其余为 DM 会话（对方头像 + 最后一条消息预览 + 未读徽标 + 时间），
 *    点击进入 /messages/[userId] 聊天窗。
 * Header carries the 新私信 people picker (mutual follows with DMs enabled)。
 */

const previewSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number(),
});

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
  // System 会话预览：最新一条通知（预览/时间）+ 未读数即可
  const systemQ = useQuery({
    queryKey: queryKeys.notificationsPreview(),
    queryFn: async () =>
      previewSchema.parse(await apiGet<unknown>("/api/notifications?limit=1")),
  });

  // eslint: 包一层 useMemo，稳定 rows 依赖（同 post-tree 的 data ?? [] 模式）
  const convs = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const loaded = !conversationsQ.isLoading && !systemQ.isLoading;
  const latestNotif = systemQ.data?.items[0];
  const systemUnread = systemQ.data?.unread ?? 0;

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

  const dmRows = useMemo(
    () =>
      convs
        .map((c) => ({
          key: `dm-${c.userId}`,
          displayName: c.displayName,
          avatarPath: c.avatarPath,
          preview: c.lastMessage
            ? `${c.lastMessage.mine ? (zh ? "我: " : "You: ") : ""}${mentionSyntaxToPlainText(c.lastMessage.body)}`
            : `@${c.username}`,
          time: c.lastMessage?.createdAt ?? null,
          unread: c.unread,
          dmUserId: c.userId,
        }))
        .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")),
    [convs, zh],
  );

  // 实时接入（单例 SSE 总线）：新消息 / 已读回执 / 新通知 / 断线重连都会
  // 改变会话预览与未读 → 失效两个列表查询（角标由 use-local-unread 负责）。
  useRealtime((event) => {
    if (
      event.type === "message.created" ||
      event.type === "message.read" ||
      event.type === "notification.created" ||
      event.type === "realtime.reconnected"
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsPreview() });
    }
  });

  function pick(uid: string) {
    setComposeOpen(false);
    router.push(`/messages/${uid}`);
  }

  const rowCls = "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--hover)]";

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-3 pr-2">
        <h2 className="text-[15px] font-normal">{zh ? "消息" : "Messages"}</h2>
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
        ) : (
          <ul>
            {/* System 官方会话 — 始终置顶 */}
            <li className="border-b border-border">
              <Link
                href="/messages/system"
                className={cn(
                  rowCls,
                  systemUnread > 0 && "bg-primary/5",
                  selectedUserId === "system" && "bg-[var(--selected)]",
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-primary/10 text-primary">
                  <Bot className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm text-foreground", systemUnread > 0 && "font-semibold")}>
                      System
                    </span>
                    {latestNotif?.createdAt && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(latestNotif.createdAt, locale)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {/* 预览是纯文本槽位：mention 语法（含修复前落库的历史行）拉平为 @昵称 */}
                      {latestNotif
                        ? mentionSyntaxToPlainText(latestNotif.body || latestNotif.title)
                        : zh
                          ? "官方系统通知"
                          : "Official system notices"}
                    </span>
                    {systemUnread > 0 && (
                      <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums">
                        {systemUnread > 99 ? "99+" : systemUnread}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>

            {dmRows.map((row) => (
              <li key={row.key} className="border-b border-border last:border-b-0">
                <Link
                  href={`/messages/${row.dmUserId}`}
                  className={cn(
                    rowCls,
                    row.unread > 0 && "bg-primary/5",
                    selectedUserId && row.dmUserId === selectedUserId && "bg-[var(--selected)]",
                  )}
                >
                  <Avatar className="size-10">
                    {row.avatarPath && (
                      <AvatarImage src={mediaUrl(row.avatarPath)} alt={row.displayName} />
                    )}
                    <AvatarFallback>{row.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm text-foreground", row.unread > 0 && "font-semibold")}>
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
                </Link>
              </li>
            ))}

            {dmRows.length === 0 && (
              <li className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                {zh ? "还没有私信会话。互相关注后即可私信。" : "No DM conversations yet. Mutual follows can DM."}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
