"use client";

import Link from "next/link";
import { useUiRegistryVersion } from "@/lib/plugins/registry";
import { PenLine } from "lucide-react";
import {
  LogOut,
  NotebookPen,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle, LocaleToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";
import { postJson } from "@/lib/client/api";
import { getUserMenuItems } from "@/lib/plugins/registry";
import type { ShellUser } from "./types";

export function UserMenu({
  user,
  isAdmin,
  mobile,
  siteName,
  locale,
}: {
  user: ShellUser;
  isAdmin: boolean;
  /** mobile avatar-only trigger vs desktop full chip */
  mobile?: boolean;
  siteName: string;
  locale: "zh" | "en";
}) {
  useUiRegistryVersion(); // 扩展注册变化时重渲菜单

  async function logout() {
    await postJson("/api/auth/logout", {}).catch(() => undefined);
    // 整页跳转：会话边界不做 SPA 导航（replace+refresh 双 RSC 请求会触发
    // flight 客户端竞态 enqueueModel 崩溃），同时确保客户端缓存全部清空
    window.location.replace("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="账号菜单"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-full transition-colors outline-none hover:bg-[var(--hover,#f7f8f8)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            mobile ? "p-0.5" : "p-1.5",
          )}
        >
          <Avatar className="size-8 border border-border">
            {user.avatarPath && (
              <AvatarImage src={routes.media(user.avatarPath)} alt={user.displayName} />
            )}
            <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          {!mobile && (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold leading-tight">
                {user.displayName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={mobile ? "bottom" : "top"} className="w-56">
        <DropdownMenuLabel>
          <div className="text-sm font-semibold text-foreground">{user.displayName}</div>
          <div className="text-xs text-muted-foreground">@{user.username}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={routes.profile(user.username)}>
            <UserIcon /> 我的主页
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/write/posts">
            <NotebookPen /> 文章管理
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={routes.settings()}>
            <Settings /> 设置
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href={routes.admin()}>
              <ShieldCheck /> 管理后台
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-muted-foreground">主题 / 语言</span>
          <span className="flex items-center gap-1">
            <LocaleToggle current={locale} />
            <ThemeToggle />
          </span>
        </div>
        {getUserMenuItems().length > 0 && (
          <>
            <DropdownMenuSeparator />
            {getUserMenuItems().map((item) => (
              <DropdownMenuItem key={item.id} asChild>
                <Link href={item.href}>
                  <PenLine className="size-4" />
                  {locale === "zh" ? item.label.zh : item.label.en}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
          <LogOut /> 退出登录
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">{siteName}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
