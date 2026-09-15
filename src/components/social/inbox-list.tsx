"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Loader2, SquarePen } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { mediaUrl, postJson, requestJson } from "./api";

/**
 * Unified message stream — the left pane of the inbox. DM conversations and
 * system notifications (抽象为"系统发给用户的消息") merge into one
 * time-sorted stream. The header carries the 新私信 people picker (mutual
 * follows with DMs enabled) and 全部已读 for notifications.
 */

interface Conversation {
  userId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  lastMessage: { body: string; createdAt: string; mine: boolean } | null;
  unread: number;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { username: string; displayName: string; avatarPath: string | null } | null;
}

interface AllowedUser {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
}

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
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [notifs, setNotifs] = useState<NotificationItem[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [allowed, setAllowed] = useState<AllowedUser[] | null>(null);
  const [allowedLoading, setAllowedLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([
        requestJson<Conversation[]>("/api/messages/conversations"),
        requestJson<{ items: NotificationItem[] }>("/api/notifications"),
      ]);
      setConvs(c);
      setNotifs(n.items ?? []);
    } catch {
      // transient failures keep the previous lists
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await fetchAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  const rows = useMemo<InboxRow[]>(() => {
    if (convs === null || notifs === null) return [];
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

  const unreadNotifs = (notifs ?? []).filter((n) => !n.readAt).length;

  async function markAllRead() {
    setNotifs((prev) => (prev ?? []).map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    try {
      await postJson("/api/notifications/read-all", {});
    } catch {
      // best-effort
    }
  }

  /** system rows: mark read, then navigate to the notification's target */
  function openSystem(n: NotificationItem) {
    if (!n.readAt) {
      setNotifs((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      void postJson("/api/notifications/read", { id: n.id }).catch(() => undefined);
    }
    if (n.url) router.push(n.url);
  }

  async function togglePicker() {
    const next = !composeOpen;
    setComposeOpen(next);
    if (next && allowed === null) {
      setAllowedLoading(true);
      try {
        const r = await requestJson<{ items: AllowedUser[] }>("/api/messages/allowed");
        setAllowed(r.items);
      } catch {
        setAllowed([]);
      } finally {
        setAllowedLoading(false);
      }
    }
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
            onClick={togglePicker}
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
          {allowedLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : allowed !== null && allowed.length > 0 ? (
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
                    <button
                      type="button"
                      onClick={() => openSystem(row.notification!)}
                      className={cn(cls, "w-full cursor-pointer")}
                    >
                      {inner}
                    </button>
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
