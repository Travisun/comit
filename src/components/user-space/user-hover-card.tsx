"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CalendarDays, Clock } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import { FollowButton } from "@/components/social/follow-button";
import { BadgeChip } from "@/extensions/badges/badge-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";

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

const PANEL_W = 288; // w-72

/**
 * 用户身份悬浮卡片 — hover 头像/昵称 250ms 后展示，包含身份信息、徽章、
 * 关注按钮与 @ 提及按钮。@ 点击 → 派发 composer:mention 事件（composer
 * 存在时由其插入 @昵称 到正文）。
 *
 * 渲染实现：面板 Portal 到 document.body + fixed 定位。此前是宿主内
 * absolute —— 详情页 sticky TimelineHeader（自身构成层叠上下文且带
 * backdrop-blur）会把面板困在其 z 层内，正文按 DOM 顺序后绘制即覆盖面板；
 * Portal 后面板脱离所有祖先层叠上下文与 overflow 裁切。
 *
 * 数据与关停：卡片数据按用户缓存（首次 hover 拉取一次，重开不再闪「加载中」，
 * 此即「悬停→移入面板出现两次加载」的根因之一：面板中途关闭重开即重发请求）；
 * 关停定时器到期时二次确认指针已同时离开宿主与面板，穿越 6px 间隙不再误关。
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const hostRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computePos = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - PANEL_W - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  const openPanel = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (open) return;
    openTimer.current = setTimeout(() => {
      computePos();
      setOpen(true);
      if (!data) {
        // 首次拉取；已有缓存直接展示，避免重开时的二次加载闪烁
        setLoading(true);
        apiGet<CardData>(`/api/users/${encodeURIComponent(username)}/card`)
          .then(setData)
          .catch(() => setLoading(false))
          .finally(() => setLoading(false));
      }
    }, 250);
  }, [username, open, data, computePos]);

  const closePanel = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => {
      // 到期二次确认：指针仍停留在宿主或面板上（穿越间隙/绕行中）则不关
      if (hostRef.current?.matches(":hover") || panelRef.current?.matches(":hover")) return;
      setOpen(false);
    }, 180);
  }, []);

  // 打开期间跟随滚动/缩放重新定位（fixed 锚定视口坐标）
  useEffect(() => {
    if (!open) return;
    const onMove = () => computePos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, computePos]);

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

  const panel = open ? (
    <div
      ref={panelRef}
      onMouseEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
      }}
      onMouseLeave={closePanel}
      style={{
        position: "fixed",
        top: (pos?.top ?? 0) + 6,
        left: pos?.left ?? 0,
        width: PANEL_W,
      }}
      className="z-[90] rounded-xl border border-border bg-card/80 backdrop-blur-md p-4 text-left shadow-[var(--shadow-overlay)]"
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
                href={routes.profile(data.username)}
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
              {data.badges.map((b, i) => <BadgeChip key={i} badge={b} />)}
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
    </div>
  ) : null;

  return (
    <span
      ref={hostRef}
      className={cn("relative inline-block", className)}
      onMouseEnter={openPanel}
      onMouseLeave={closePanel}
    >
      {children}
      {panel ? createPortal(panel, document.body) : null}
    </span>
  );
}
