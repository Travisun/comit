"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import { FollowButton } from "@/components/social/follow-button";
import { BadgeChip } from "@/extensions/badges/badge-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface CardData {
  username: string;
  displayName: string;
  avatarPath: string | null;
  bio: string;
  createdAt: string;
  lastLoginAt: string | null;
  badges: { name: string; text: string; icon: string; style: string }[];
  isSelf: boolean;
  following: boolean;
  viewerSignedIn: boolean;
}

/**
 * 用户身份悬浮卡片 — hover 头像/昵称 300ms 后展示，包含身份信息、徽章、
 * 关注按钮与 @ 提及按钮。@ 点击 → 派发 composer:mention 事件（composer
 * 存在时由其插入 @昵称 到正文）。
 */
export function UserHoverCard({
  username,
  children,
  className,
}: {
  username: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const hostRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPanel = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => {
      setOpen(true);
      setLoading(true);
      apiGet<CardData>(`/api/users/${encodeURIComponent(username)}/card`)
        .then(setData)
        .catch(() => setLoading(false))
        .finally(() => setLoading(false));
    }, 250);
  }, [username]);

  const closePanel = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }, []);

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function onMention() {
    const nick = `@${data?.displayName ?? username} `;
    window.dispatchEvent(new CustomEvent("composer:mention", { detail: { mention: nick } }));
    setOpen(false);
  }

  return (
    <span
      ref={hostRef}
      className={cn("relative inline-block", className)}
      onMouseEnter={openPanel}
      onMouseLeave={closePanel}
    >
      {children}
      {open && (
        <span
          ref={panelRef}
          onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
          onMouseLeave={closePanel}
          className={cn(
            "absolute z-[90] w-72 rounded-xl border border-border bg-card/80 backdrop-blur-md p-4 shadow-[var(--shadow-overlay)]",
            "left-0 top-full mt-1.5 block text-left",
          )}
        >
          {loading || !data ? (
            <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <Avatar className="size-11 shrink-0">
                  {data.avatarPath && <AvatarImage src={`/api/media/file/${data.avatarPath}`} alt={data.displayName} />}
                  <AvatarFallback>{data.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${data.username}`}
                    className="block truncate text-sm font-semibold text-foreground hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    {data.displayName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">@{data.username}</p>
                </div>
              </div>
              {data.bio && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{data.bio}</p>}
              {data.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {data.badges.map((b, i) => (
                    <BadgeChip key={i} badge={b} />
                  ))}
                </div>
              )}
              <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1"><CalendarDays className="size-3" /> 加入 {formatDate(data.createdAt, "zh")}</p>
                {data.lastLoginAt && <p className="flex items-center gap-1"><Clock className="size-3" /> 最近 {formatDate(data.lastLoginAt, "zh")}</p>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {data.viewerSignedIn && !data.isSelf && (
                  <FollowButton
                    username={data.username}
                    initialFollowing={data.following}
                    className="h-7 min-h-0 flex-1 rounded-full px-3 text-xs font-medium"
                  />
                )}
                <button
                  type="button"
                  onClick={onMention}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-[var(--hover)]"
                >
                  @TA
                </button>
              </div>
            </>
          )}
        </span>
      )}
    </span>
  );
}
