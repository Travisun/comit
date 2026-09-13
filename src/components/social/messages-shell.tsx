"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { mediaUrl, requestJson } from "./api";

interface ConversationItem {
  userId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  lastMessage: { body: string; createdAt: string; mine: boolean } | null;
  unread: number;
}

export function ConversationList({ selectedUserId }: { selectedUserId?: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ConversationItem[] | null>(null);

  // fetch now + poll every 30s; re-runs when switching conversations so the
  // unread counts stay fresh (async IIFE keeps setState out of the sync path)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await requestJson<ConversationItem[]>("/api/messages/conversations");
        if (!cancelled) setItems(r);
      } catch {
        // transient failures keep the previous list
      }
    })();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const r = await requestJson<ConversationItem[]>("/api/messages/conversations");
          if (!cancelled) setItems(r);
        } catch {
          // ignore polling failures
        }
      })();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedUserId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <MessageCircle className="size-4" />
          {t("messages.title")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {items === null ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("messages.mutualRequired")}</p>
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.userId} className="border-b border-border last:border-b-0">
                <Link
                  href={`/messages/${c.userId}`}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--hover)]",
                    selectedUserId === c.userId && "bg-[var(--selected)]",
                  )}
                >
                  <Avatar className="size-10">
                    {c.avatarPath && (
                      <AvatarImage src={mediaUrl(c.avatarPath)} alt={c.displayName} />
                    )}
                    <AvatarFallback>{c.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {c.displayName}
                      </span>
                      {c.lastMessage && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(c.lastMessage.createdAt, locale)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {c.lastMessage
                          ? `${c.lastMessage.mine ? (locale === "zh" ? "我: " : "You: ") : ""}${c.lastMessage.body}`
                          : `@${c.username}`}
                      </span>
                      {c.unread > 0 && (
                        <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Two-pane messages layout. On mobile only one pane shows at a time:
 * without `selectedUserId` the list is visible; with it, the chat pane.
 */
export function MessagesShell({
  selectedUserId,
  children,
}: {
  selectedUserId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] w-full md:h-full">
      <aside
        className={cn(
          "w-full shrink-0 flex-col md:flex md:w-72 md:border-r md:border-border",
          selectedUserId ? "hidden" : "flex",
        )}
      >
        <ConversationList selectedUserId={selectedUserId} />
      </aside>
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-background",
          selectedUserId ? "flex" : "hidden md:flex",
        )}
      >
        {children}
      </section>
    </div>
  );
}
