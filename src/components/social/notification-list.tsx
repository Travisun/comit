"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  Heart,
  Loader2,
  MessageCircle,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { mediaUrl, postJson, requestJson } from "./api";

interface NotificationItem {
  id: string;
  key: string;
  title: string;
  body: string | null;
  url: string | null;
  readAt: string | null;
  createdAt: string;
  actor: {
    username: string;
    displayName: string;
    avatarPath: string | null;
  } | null;
}

interface NotificationsResponse {
  items: NotificationItem[];
  nextCursor: string | null;
  unread: number;
}

function keyIcon(key: string) {
  if (key.startsWith("comment.")) return MessageCircle;
  if (key.startsWith("follow.")) return UserPlus;
  if (key.startsWith("message.")) return MessageCircle;
  if (key.startsWith("post.liked")) return Heart;
  if (key.startsWith("moderation.")) return ShieldAlert;
  return Bell;
}

export function NotificationList() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (cursor?: string | null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const r = await requestJson<NotificationsResponse>(`/api/notifications${qs}`);
      setItems((prev) => (cursor ? [...(prev ?? []), ...r.items] : r.items));
      setNextCursor(r.nextCursor);
      setUnread(r.unread);
    } catch {
      // silent — page still renders the empty state
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // initial page — async IIFE so no setState happens synchronously in the effect
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await requestJson<NotificationsResponse>("/api/notifications");
        if (cancelled) return;
        setItems(r.items);
        setNextCursor(r.nextCursor);
        setUnread(r.unread);
      } catch {
        // silent — page still renders the empty state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingRef.current) {
          void load(nextCursor);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, load]);

  function open(n: NotificationItem) {
    if (!n.readAt) {
      setItems((prev) =>
        (prev ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      setUnread((u) => Math.max(0, u - 1));
      void postJson("/api/notifications/read", { id: n.id }).catch(() => undefined);
    }
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    setItems((prev) =>
      (prev ?? []).map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })),
    );
    setUnread(0);
    try {
      await postJson("/api/notifications/read-all", {});
      router.refresh(); // refresh header badge
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  const isToday = (iso: string) =>
    new Date(iso).toDateString() === new Date().toDateString();

  // precompute group headers (今天 / 更早) without mutating render-scope variables
  const grouped =
    items?.map((n, i) => ({
      item: n,
      showHeader: i === 0 || isToday(n.createdAt) !== isToday(items[i - 1].createdAt),
      today: isToday(n.createdAt),
    })) ?? null;

  return (
    <div>
      {/* page title lives in the shell timeline header; keep unread + actions */}
      <div className="flex items-center justify-end gap-2 px-3 pt-2">
        {unread > 0 && (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="rounded-full font-bold"
          onClick={() => void markAllRead()}
          disabled={unread === 0}
        >
          <CheckCheck />
          {t("notify.markAllRead")}
        </Button>
      </div>

      {items === null ? (
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Bell className="size-8" />
          <p className="text-sm">{t("notify.empty")}</p>
        </div>
      ) : (
        <ul>
          {grouped?.map(({ item: n, showHeader, today }) => {
            const Icon = keyIcon(n.key);
            return (
              <li key={n.id}>
                {showHeader && (
                  <div className="px-1 pb-1.5 pt-3 text-xs font-medium text-muted-foreground">
                    {today ? (locale === "zh" ? "今天" : "Today") : locale === "zh" ? "更早" : "Earlier"}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn(
                    "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--hover,#f7f8f8)]",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  {n.actor ? (
                    <Avatar className="size-9">
                      {n.actor.avatarPath && (
                        <AvatarImage
                          src={mediaUrl(n.actor.avatarPath)}
                          alt={n.actor.displayName}
                        />
                      )}
                      <AvatarFallback>
                        {n.actor.displayName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {!n.readAt && (
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      )}
                      <span className={cn("truncate text-sm", !n.readAt ? "font-semibold text-foreground" : "text-foreground/90")}>
                        {n.title}
                      </span>
                    </span>
                    {n.body && (
                      <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {timeAgo(n.createdAt, locale)}
                    </span>
                  </span>
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div ref={sentinelRef} />
      {loading && items !== null && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
