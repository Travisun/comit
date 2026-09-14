"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Compass,
  Feather,
  Home,
  LogOut,
  Mail,
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

/* ============================================================ types ====== */

export interface ShellUser {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  unreadNotifications: number;
  unreadMessages: number;
}

/** Front-site theme experiment — flips the whole 前台 between trials without
 * touching the admin console. Visit /?theme=<name> once to switch; the
 * choice persists in localStorage across in-app navigations. Available:
 * swiss · paper · aurora · neubrutalism · oled · glass · terminal.
 * Every theme is a token/CSS block in globals.css. */
const SITE_THEMES = new Set([
  "swiss",
  "paper",
  "aurora",
  "neubrutalism",
  "oled",
  "glass",
  "terminal",
]);
const SITE_THEME_DEFAULT = "paper";
const SITE_THEME_STORAGE = "site-theme";

/* ======================================================== brand mark ===== */

/**
 * Brand mark — the official comit.sh.svg wordmark asset.
 * Dark fill by default; inverted in dark mode for the gray canvas.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/comit.sh.svg"
      alt="comit.sh"
      className={cn("h-[20px] w-auto select-none dark:invert", className)}
    />
  );
}

function BrandLink({ siteName }: { siteName: string }) {
  return (
    <Link
      href={routes.home}
      className="inline-flex items-center rounded-[10px] p-2"
      aria-label={siteName}
    >
      <BrandMark className="h-[22px]" />
    </Link>
  );
}

/** 创作 trigger — on the home page it pings the pinned composer to expand
 * and focus; anywhere else it routes home with ?compose=1. */
function ComposerTrigger({ login }: { login?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (login) {
    return (
      <Link href={login} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:w-9 md:px-0 xl:w-full xl:px-3">
        <Feather className="size-3.5" />
        <span className="hidden text-[13px] xl:inline">创作</span>
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => {
      if (pathname === "/") window.dispatchEvent(new CustomEvent("composer:focus"));
      else router.push("/?compose=1");
    }}
      className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:w-9 md:px-0 xl:w-full xl:px-3">
      <Feather className="size-3.5" />
      <span className="hidden text-[13px] xl:inline">创作</span>
    </button>
  );
}

/* ======================================================== user menu ====== */

function UserMenu({
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
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
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

/* ====================================================== desktop nav ====== */

function NavIcon({ children, badge }: { children: ReactNode; badge?: number }) {
  return (
    <span className="relative shrink-0">
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1.5 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </span>
  );
}

function LeftNav({
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
  const pathname = usePathname();
  const login = routes.login;

  const items = [
    { href: routes.home, label: "首页", icon: <Home className="size-[18px]" />, exact: true },
    { href: routes.explore, label: "发现", icon: <Compass className="size-[18px]" /> },
    {
      // unified inbox: DMs + notifications live together under /messages
      href: user ? routes.messages : login,
      label: "消息",
      icon: (
        <NavIcon badge={(user?.unreadNotifications ?? 0) + (user?.unreadMessages ?? 0)}>
          <Mail className="size-[18px]" />
        </NavIcon>
      ),
    },
    {
      href: user ? routes.profile(user.username) : login,
      label: "个人主页",
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
      className="hidden h-full w-16 shrink-0 flex-col px-2 py-3 md:flex xl:w-[208px] xl:px-3"
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
              {item.icon}
              <span className="hidden text-sm xl:inline">{item.label}</span>
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
          <UserIcon className="size-5 xl:hidden" />
          <span className="hidden xl:inline">登录 / 注册</span>
        </Link>
      )}
    </nav>
  );
}

/* ======================================================= mobile chrome === */

function MobileTopBar({
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

function MobileTabBar({ user }: { user: ShellUser | null }) {
  const pathname = usePathname();
  const login = routes.login;
  const router = useRouter();

  const tabs = [
    { href: routes.home, label: "首页", icon: <Home className="size-[18px]" />, exact: true },
    { href: routes.explore, label: "发现", icon: <Compass className="size-[18px]" /> },
    { href: user ? "#compose" : login, label: "创作", fab: true },
    {
      href: user ? routes.messages : login,
      label: "消息",
      icon: (
        <NavIcon badge={(user?.unreadNotifications ?? 0) + (user?.unreadMessages ?? 0)}>
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

/* ========================================================== the shell ==== */

/** Route prefixes that render without the social chrome (centered card pages). */
const BARE_PREFIXES = ["/auth", "/legal", "/about"];
export function SiteShell({
  user,
  locale,
  siteName,
  rail,
  footer,
  children,
}: {
  user: ShellUser | null;
  locale: "zh" | "en";
  siteName: string;
  /** server-rendered right rail (hidden on narrow screens and some routes) */
  rail?: ReactNode;
  /** server-rendered slim footer below the timeline area */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = user?.role === "admin";

  // front-site theme (E-Ink light / Swiss) is scoped via <body>: portaled
  // surfaces inherit the tokens too, and it is removed on unmount so the
  // admin console keeps the base Stripe palette
  useEffect(() => {
    const apply = (name: string) => {
      for (const t of SITE_THEMES) document.body.classList.remove(`theme-${t}`);
      document.body.classList.add(`theme-${name}`);
    };
    // explicit ?theme= wins and is remembered; otherwise keep the stored one
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param && SITE_THEMES.has(param)) {
      localStorage.setItem(SITE_THEME_STORAGE, param);
      apply(param);
    } else {
      const stored = localStorage.getItem(SITE_THEME_STORAGE);
      apply(stored && SITE_THEMES.has(stored) ? stored : SITE_THEME_DEFAULT);
    }
    return () => {
      for (const t of SITE_THEMES) document.body.classList.remove(`theme-${t}`);
    };
  }, []);

  const bare = BARE_PREFIXES.some((p) => pathname.startsWith(p));
  if (bare) return <>{children}</>;

  // app-surface pages (messenger) take the full panel width without the rail
  const isFullWidth = pathname.startsWith("/messages");

    return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)] md:h-dvh md:overflow-hidden">
      <MobileTopBar user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} />

      {/* two columns: icon/text nav | main zone. The main zone's panel spans
          to the container's right edge and splits into content | rail. */}
      <div className="mx-auto flex h-full w-full max-w-[1200px]">
      <LeftNav user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} />

      <main className="min-w-0 flex-1 pb-16 md:flex md:h-full md:pb-0">
        {/* the panel — two inner columns on xl: content | rail */}
        <div
          className={cn(
            "flex w-full min-w-0 flex-col bg-card md:my-[10px] md:h-[calc(100%-20px)] md:flex-row md:overflow-hidden md:rounded-2xl md:border md:border-[var(--center-border)] md:scrollbar-none",
          )}
        >
          {/* content column — owns the scroll on md+ */}
          <div
            data-composer-anchor
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              !isFullWidth && "md:overflow-y-auto md:scrollbar-none",
            )}
          >
            <div className="flex flex-1 justify-center">{children}</div>
            {footer}
          </div>

          {/* right rail — merged into the panel as its own scroll column (xl only) */}
          {!isFullWidth && rail != null && (
            <aside className="hidden w-[320px] shrink-0 border-l border-border xl:flex xl:flex-col">
              <div className="h-full space-y-3 overflow-y-auto px-5 py-4 scrollbar-none">
                {rail}
              </div>
            </aside>
          )}
        </div>
      </main>
      </div>

      <MobileTabBar user={user} />
    </div>
  );
}

/* ==================================================== timeline header ==== */

/**
 * Sticky, translucent timeline header (X-style): optional back button,
 * title/subtitle, trailing slot, and an optional tab strip below.
 */
export function TimelineHeader({
  title,
  subtitle,
  back = false,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** show a ← back button (router.back with home fallback) */
  back?: boolean;
  right?: ReactNode;
  /** tab strip / custom row rendered below the title bar */
  children?: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  if (!title && !subtitle && !back && !right && children) {
    // tabs-only header (home)
    return (
      <div
        className={cn(
          "sticky top-12 z-30 bg-card/80 backdrop-blur-md md:top-0",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "sticky top-12 z-30 bg-card/80 backdrop-blur-md md:top-0",
        className,
      )}
    >
      <div className="flex min-h-12 items-center gap-3 px-4 py-1.5">
        {back && (
          <button
            type="button"
            aria-label="返回"
            onClick={() =>
              typeof window !== "undefined" && window.history.length > 1
                ? router.back()
                : router.push(routes.home)
            }
            className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--hover,#f7f8f8)]"
          >
            <ArrowLeft className="size-[18px]" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {title && <h1 className="truncate text-[19px] font-bold leading-tight">{title}</h1>}
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * X-style underline tab strip: equal-width items, bold active label with a
 * rounded orange indicator. Pure links — server-renderable.
 */
export function UnderlineTabs({
  tabs,
  className,
}: {
  tabs: { key: string; label: ReactNode; href?: string; active?: boolean; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <nav className={cn("grid auto-cols-fr grid-flow-col border-b border-border", className)} aria-label="页签">
      {tabs.map((tab) => {
        const inner = (
          <>
            <span className={cn("relative py-3.5 text-[15px]", tab.active && "font-bold")}>
              {tab.label}
              {tab.active && (
                <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-[3px] bg-primary" />
              )}
            </span>
          </>
        );
        const cls = cn(
          "relative grid place-items-center px-4 transition-colors",
          tab.disabled
            ? "cursor-not-allowed text-muted-foreground"
            : "text-muted-foreground hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground",
          tab.active && "text-foreground",
        );
        return tab.href && !tab.disabled ? (
          <Link key={tab.key} href={tab.href} aria-current={tab.active ? "page" : undefined} className={cls}>
            {inner}
          </Link>
        ) : (
          <span key={tab.key} aria-disabled className={cls}>
            {inner}
          </span>
        );
      })}
    </nav>
  );
}
