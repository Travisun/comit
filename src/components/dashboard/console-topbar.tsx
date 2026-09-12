"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Menu, SquarePen, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Console top bar — shared by 创作中心 (dashboard) and 管理后台 (admin).
 * Full-width h-14 strip, NO border, flat white, sticky. Left: mobile
 * hamburger + wordmark; right: bell, avatar menu.
 */

export interface ConsoleTopbarProps {
  /** Section name, e.g. 创作中心 / 管理后台 */
  section: string;
  displayName: string;
  username: string;
  avatarPath: string | null;
  /** Mobile hamburger handler — omit to hide the hamburger button. */
  onMenuClick?: () => void;
}

/** Console brand — text wordmark only (no SVG mark). */
export function BrandLogoPlaceholder({ compact = false }: { compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label="comit.sh"
      className={cn(
        "inline-flex select-none items-baseline font-mono font-extrabold tracking-[-0.04em] text-foreground",
        compact ? "text-[15px] leading-none" : "text-[17px] leading-none",
      )}
    >
      comit<span className="text-primary">.</span>sh
    </span>
  );
}

export function ConsoleTopbar({
  section,
  displayName,
  username,
  avatarPath,
  onMenuClick,
}: ConsoleTopbarProps) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  // Best-effort unread count for the bell; stays silent on failure.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications?limit=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { unread?: number } | null) => {
        if (!cancelled && data && typeof data.unread === "number") setUnread(data.unread);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 bg-white">
      <div className="flex h-full items-center justify-between gap-3 px-4 md:px-6">
        {/* left: hamburger + brand */}
        <div className="flex min-w-0 items-center gap-3">
          {onMenuClick ? (
            <button
              type="button"
              aria-label="打开导航菜单"
              onClick={onMenuClick}
              className="-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground lg:hidden"
            >
              <Menu className="size-4.5" />
            </button>
          ) : null}
          <Link href="/write/posts" aria-label="comit.sh" className="shrink-0">
            <BrandLogoPlaceholder />
          </Link>
        </div>

        {/* right: bell + avatar */}
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <Link
            href="/notifications"
            aria-label={unread > 0 ? `${unread} 条未读通知` : "通知"}
            className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground"
          >
            <Bell className="size-4.5" />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="账户菜单"
                className="ml-0.5 flex items-center gap-2 rounded-md border border-transparent p-0.5 transition-colors hover:bg-[var(--hover,#f7f8f8)]"
              >
                <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-bold text-foreground">
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
              <DropdownMenuLabel>
                <span className="block truncate text-sm font-semibold">{displayName}</span>
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
      </div>
    </header>
  );
}