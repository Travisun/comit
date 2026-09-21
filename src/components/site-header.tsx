"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  PenLine,
  Bell,
  LogOut,
  Settings,
  User as UserIcon,
  ShieldCheck,
  Menu,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoFull } from "@/components/brand/logo";
import { postJson } from "@/lib/client/api";
import { routes } from "@/core/routes";
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

export interface HeaderUser {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  unreadNotifications: number;
}

export function SiteHeader({
  user,
  locale,
  isAdmin,
}: {
  user: HeaderUser | null;
  locale: "zh" | "en";
  siteName: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = [
    { href: "/", label: locale === "zh" ? "首页" : "Home" },
    { href: "/feed", label: locale === "zh" ? "动态" : "Feed" },
    { href: "/explore", label: locale === "zh" ? "发现" : "Explore" },
  ];

  async function logout() {
    await postJson("/api/auth/logout", {}).catch(() => undefined);
    // 整页跳转：会话边界不做 SPA 导航（replace+refresh 双 RSC 请求会触发
    // flight 客户端竞态 enqueueModel 崩溃），同时确保客户端缓存全部清空
    window.location.replace("/");
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
      <div className="mx-auto flex h-[var(--header-h)] max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 py-1 font-bold text-[15px] tracking-tight">
          <LogoFull height={20} />
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname === item.href && "bg-muted text-foreground font-medium",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <LocaleToggle current={locale} />
          <ThemeToggle />
          {user ? (
            <>
              <Button asChild variant="default" size="sm" className="hidden sm:inline-flex ml-1">
                <Link href="/write">
                  <PenLine className="size-3.5" />
                  {locale === "zh" ? "写文章" : "Write"}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon" aria-label="Notifications" className="relative">
                <Link href="/notifications">
                  <Bell className="size-4" />
                  {user.unreadNotifications > 0 && (
                    <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                      {user.unreadNotifications > 99 ? "99+" : user.unreadNotifications}
                    </span>
                  )}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                    <Avatar className="size-8">
                      {user.avatarPath && <AvatarImage src={`/api/media/file/${user.avatarPath}`} alt={user.displayName} />}
                      <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <div className="font-medium text-foreground text-sm">{user.displayName}</div>
                    <div className="text-xs text-muted-foreground">@{user.username}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={routes.profile(user.username)}>
                      <UserIcon /> {locale === "zh" ? "我的主页" : "My profile"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/messages">
                      <MessageCircle /> {locale === "zh" ? "私信" : "Messages"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings /> {locale === "zh" ? "设置" : "Settings"}
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin">
                        <ShieldCheck /> {locale === "zh" ? "管理后台" : "Admin"}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                    <LogOut /> {locale === "zh" ? "退出登录" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu">
                <Menu className="size-4" />
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/auth/login">{locale === "zh" ? "登录" : "Sign in"}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/auth/register">{locale === "zh" ? "注册" : "Sign up"}</Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      {mobileOpen && user && (
        <nav className="bg-card px-4 py-2 md:hidden animate-[slide-up_0.2s_ease]">
          {[...nav, { href: "/write", label: locale === "zh" ? "写文章" : "Write" }].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
