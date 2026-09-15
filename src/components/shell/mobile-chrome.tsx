"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Compass,
  Feather,
  Home,
  User as UserIcon,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";
import { BrandMark } from "./brand";
import { NavIcon } from "./left-nav";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./types";
import type { LocalUnread } from "@/components/user-space/use-local-unread";

export function MobileTopBar({
  user,
  isAdmin,
  siteName,
  locale,
}: {
  user: ShellUser | null;
  isAdmin: boolean;
  siteName: string;
  locale: "zh" | "en";
}) {
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between bg-card px-3 md:hidden">
      <Link
        href={routes.home}
        className="inline-flex items-center gap-2 rounded-full p-1.5 font-bold tracking-tight"
        aria-label={siteName}
      >
        <BrandMark className="size-7" />
        <span className="text-[15px]">{siteName}</span>
      </Link>
      {user ? (
        <div className="w-9">
          <UserMenu user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} mobile />
        </div>
      ) : (
        <Link
          href={routes.login}
          className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-primary-foreground"
        >
          登录
        </Link>
      )}
    </header>
  );
}

export function MobileTabBar({ user, unread }: { user: ShellUser | null; unread: LocalUnread }) {
  const pathname = usePathname();
  const login = routes.login;
  const router = useRouter();

  const tabs = [
    { href: routes.home, label: "最新", icon: <NavIcon badge={unread.latest}><Home className="size-[18px]" /></NavIcon>, exact: true },
    { href: user ? routes.following : login, label: "关注", icon: <NavIcon badge={unread.following}><Users className="size-[18px]" /></NavIcon> },
    { href: routes.explore, label: "发现", icon: <Compass className="size-[18px]" /> },
    { href: user ? "#compose" : login, label: "创作", fab: true },
    {
      href: user ? routes.messages : login,
      label: "消息",
      icon: (
        <NavIcon badge={unread.messages}>
          <Bell className="size-[18px]" />
        </NavIcon>
      ),
    },
    {
      href: user ? routes.profile(user.username) : login,
      label: "我",
      icon: user ? (
        <Avatar className="size-[18px]">
          {user.avatarPath && (
            <AvatarImage src={routes.media(user.avatarPath)} alt={user.displayName} />
          )}
          <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      ) : (
        <UserIcon className="size-[18px]" />
      ),
    },
  ];

  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : !tab.fab && pathname.startsWith(tab.href);
        if (tab.fab && user) {
          // FAB: on the home page ping the pinned composer, elsewhere route home
          return (
            <button
              key={tab.label}
              type="button"
              aria-label={tab.label}
              onClick={() => {
                if (pathname === "/") window.dispatchEvent(new CustomEvent("composer:focus"));
                else router.push("/?compose=1");
              }}
              className="flex flex-1 items-center justify-center"
            >
              <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-none transition-opacity active:opacity-80">
                <Feather className="size-[18px]" />
              </span>
            </button>
          );
        }
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 items-center justify-center"
          >
            {tab.fab ? (
              <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-none">
                <Feather className="size-[18px]" />
              </span>
            ) : (
              <span
                className={cn(
                  "grid place-items-center rounded-full p-2 transition-colors",
                  active ? "text-foreground [&_svg]:stroke-[2.5]" : "text-muted-foreground",
                )}
              >
                {tab.icon}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
