"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import Link from "next/link";
import { Bell, LogOut, Menu, Plus, Settings, SquarePen, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiGet, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";

/**
 * Console header — belongs to the RIGHT content area only (the sidebar is a
 * fixed full-height column with the brand on its left). Stripe Dashboard
 * style: borderless white strip, sticky. Left: mobile hamburger + section
 * name; right: bell, settings, Create (+) and the account menu at the very
 * top-right corner.
 */

export interface ConsoleTopbarProps {
  /** Section name — omit on tool-style pages (e.g. the editor). */
  section?: string;
  /** Current user — powers the top-right account menu. */
  displayName: string;
  username: string;
  avatarPath: string | null;
  /** Extra actions rendered at the right edge, before the console ops. */
  actions?: React.ReactNode;
  /** Mobile hamburger handler — omit to hide the hamburger button. */
  onMenuClick?: () => void;
}

export function ConsoleTopbar({
  section,
  displayName,
  username,
  avatarPath,
  actions,
  onMenuClick,
}: ConsoleTopbarProps) {

  // Best-effort unread count for the bell; stays silent on failure.
  // 键挂在 ["notifications"] 前缀下 —— 收件箱置已读会连带刷新角标。
  const unreadQ = useQuery({
    queryKey: queryKeys.notificationBadge(),
    queryFn: async () =>
      z
        .object({ unread: z.number().optional() })
        .parse(await apiGet<unknown>("/api/notifications?limit=1")),
  });
  const unread = unreadQ.data?.unread ?? 0;

  async function logout() {
    await postJson("/api/auth/logout", {}).catch(() => undefined);
    // 整页跳转：会话边界不做 SPA 导航（replace+refresh 双 RSC 请求会触发
    // flight 客户端竞态 enqueueModel 崩溃），同时确保客户端缓存全部清空
    window.location.replace("/");
  }

  return (
    <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between gap-3 bg-[var(--background)] px-4 md:px-5">
      {/* left: hamburger + section name (where Stripe places global search) */}
      <div className="flex min-w-0 items-center gap-2">
        {onMenuClick ? (
          <button
            type="button"
            aria-label="打开导航菜单"
            onClick={onMenuClick}
            className="-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground lg:hidden"
          >
            <Menu className="size-4.5" />
          </button>
        ) : null}
        {section ? (
          <span className="truncate text-sm font-medium text-muted-foreground">{section}</span>
        ) : null}
      </div>

      {/* right: page actions + bell + settings + create + account menu */}
      <div className="flex shrink-0 items-center gap-1 md:gap-1.5">
        {actions}
        <Link
          href="/notifications"
          aria-label={unread > 0 ? `${unread} 条未读通知` : "通知"}
          className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <Link
          href="/settings/profile"
          aria-label="账户设置"
          className="hidden sm:inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>

        <Link
          href="/write"
          aria-label="创作"
          title="创作"
          className="ml-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Plus className="size-4" />
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`账户菜单 — ${displayName}`}
              className="ml-0.5 grid size-8 place-items-center rounded-full outline-none transition-shadow focus-visible:shadow-[0_0_0_4px_var(--ring)] hover:shadow-[0_0_0_1px_var(--border)]"
            >
              <span className="grid size-8 place-items-center overflow-hidden rounded-full border border-border bg-card text-xs font-semibold text-foreground">
                {avatarPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/media/file/${avatarPath}`}
                    alt={displayName}
                    className="size-full object-cover"
                  />
                ) : (
                  displayName.slice(0, 1).toUpperCase()
                )}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="normal-case tracking-normal">
              <span className="block truncate text-sm font-semibold text-foreground">{displayName}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                @{username}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/u/${username}`} target="_blank">
                <UserRound />
                个人主页
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/profile">
                <SquarePen />
                账户设置
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
