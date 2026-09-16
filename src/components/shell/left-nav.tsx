"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUiRegistryVersion } from "@/lib/plugins/registry";
import type { ReactNode } from "react";
import {
  Compass,
  Home,
  Mail,
  Settings,
  User as UserIcon,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";
import { BrandLink, ComposerTrigger } from "./brand";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./types";
import { getNavItems } from "@/lib/plugins/registry";
import type { LocalUnread } from "@/components/user-space/use-local-unread";

export function NavIcon({
  children,
  badge,
  className,
}: {
  children: ReactNode;
  badge?: number;
  className?: string;
}) {
  return (
    <span className={cn("relative shrink-0", className)}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground tabular-nums lg:hidden">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </span>
  );
}

export function LeftNav({
  user,
  isAdmin,
  siteName,
  locale,
  unread,
}: {
  user: ShellUser | null;
  isAdmin: boolean;
  siteName: string;
  locale: "zh" | "en";
  unread: LocalUnread;
}) {
  useUiRegistryVersion(); // 扩展注册变化时重渲导航
  const pathname = usePathname();
  const login = routes.login;

  const items = [
    { href: routes.home, label: "最新", icon: <Home className="size-[18px]" />, exact: true, badge: unread.latest },
    { href: user ? routes.following : login, label: "关注", icon: <Users className="size-[18px]" />, badge: unread.following },
    { href: routes.explore, label: "发现", icon: <Compass className="size-[18px]" /> },
    {
      // unified inbox: DMs + notifications live together under /messages
      href: user ? routes.messages : login,
      label: "消息",
      icon: <Mail className="size-[18px]" />,
      badge: unread.messages,
    },
    {
      href: user ? routes.profile(user.username) : login,
      label: "主页",
      icon: <UserIcon className="size-[18px]" />,
    },
    {
      href: "/settings",
      label: "设置",
      icon: <Settings className="size-[18px]" />,
    },
  ];

  return (
    <nav
      aria-label="主导航"
      className="hidden h-full w-16 shrink-0 flex-col px-2 py-3 md:flex lg:w-[208px] lg:px-3"
    >
      <div className="mb-2 ml-1">
        <BrandLink siteName={siteName} />
      </div>

      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-full px-3 py-2 transition-colors hover:bg-[var(--hover,#f7f8f8)]",
                active ? "font-semibold text-foreground bg-[var(--selected)]" : "text-foreground/90",
              )}
            >
              <NavIcon badge={item.badge}>{item.icon}</NavIcon>
              <span className="relative hidden text-sm lg:inline">
                {item.label}
                {item.badge ? (
                  <span className="absolute -top-1.5 right-0 grid h-[16px] min-w-[16px] translate-x-full place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}

        {/* 扩展注册的导航项 */}
        {getNavItems(user ? "user" : "all").map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-full px-3 py-2 transition-colors hover:bg-[var(--hover,#f7f8f8)]",
                active ? "font-semibold text-foreground bg-[var(--selected)]" : "text-foreground/90",
              )}
            >
              {Icon ? <Icon className="size-[18px]" /> : <Compass className="size-[18px]" />}
              <span className="hidden truncate text-sm lg:inline">
                {locale === "zh" ? item.label.zh : item.label.en}
              </span>
            </Link>
          );
        })}

        {/* 创作 — primary action, cool black pill */}
        <ComposerTrigger login={user ? undefined : login} />
      </div>

      <div className="flex-1" />

      {user ? (
        <UserMenu user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} />
      ) : (
        <Link
          href={login}
          className="flex items-center justify-center gap-2 rounded-full p-2 text-sm font-semibold transition-colors hover:bg-[var(--hover,#f7f8f8)]"
        >
          <UserIcon className="size-5 lg:hidden" />
          <span className="hidden lg:inline">登录 / 注册</span>
        </Link>
      )}
    </nav>
  );
}
