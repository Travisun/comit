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
  Users,
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
import { useLocalUnread, type LocalUnread } from "@/components/user-space/use-local-unread";

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

/** 前台固定使用基础灰白配色 + 自托管思源黑体（.theme-site 只管字体，
 * 不覆盖颜色令牌）。列表仅用于清理历史遗留的 theme-* 类与 localStorage
 * 里的旧选择——主题实验已下线，不再切换。 */
const SITE_THEMES = new Set([
  "swiss",
  "paper",
  "aurora",
  "neubrutalism",
  "oled",
  "glass",
  "terminal",
]);
const SITE_THEME_DEFAULT = "site";
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
      <Link href={login} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:w-9 md:px-0 lg:w-full lg:px-3">
        <Feather className="size-3.5" />
        <span className="hidden text-[13px] lg:inline">创作</span>
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => {
      if (pathname === "/") window.dispatchEvent(new CustomEvent("composer:focus"));
      else router.push("/?compose=1");
    }}
      className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:w-9 md:px-0 lg:w-full lg:px-3">
      <Feather className="size-3.5" />
      <span className="hidden text-[13px] lg:inline">创作</span>
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
  unread,
}: {
  user: ShellUser | null;
  isAdmin: boolean;
  siteName: string;
  locale: "zh" | "en";
  unread: LocalUnread;
}) {
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
              <span className="hidden text-sm lg:inline">{item.label}</span>
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

function MobileTabBar({ user, unread }: { user: ShellUser | null; unread: LocalUnread }) {
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
  const localUnread = useLocalUnread(user);

  // 前台固定使用基础灰白配色（.theme-site 只覆盖字体），不再提供主题切换。
  // 仍需清理历史遗留：localStorage 里存过的主题选择和 body 上残留的 theme-* 类。
  useEffect(() => {
    localStorage.removeItem(SITE_THEME_STORAGE);
    for (const t of SITE_THEMES) document.body.classList.remove(`theme-${t}`);
    document.body.classList.add(`theme-${SITE_THEME_DEFAULT}`);
    return () => {
      document.body.classList.remove(`theme-${SITE_THEME_DEFAULT}`);
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
            <LeftNav user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} unread={localUnread} />

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
            {/* 版权信息已并入右栏底部，xl（右栏可见）下不重复展示 */}
            <div className="xl:hidden">{footer}</div>
          </div>

          {/* right rail — merged into the panel as its own scroll column (xl only) */}
          {rail != null && (
            <aside className="hidden w-[320px] shrink-0 border-l border-border xl:flex xl:flex-col">
              <div className="h-full space-y-3 overflow-y-auto px-5 pb-4 scrollbar-none">
                {rail}
              </div>
            </aside>
          )}
        </div>
      </main>
      </div>

      <MobileTabBar user={user} unread={localUnread} />
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
  tabs,
  children,
  className,
  paddingClass = "px-4",
  rowClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** show a ← back button (router.back with home fallback) */
  back?: boolean;
  right?: ReactNode;
  /** tab strip rendered inside the same sticky header block */
  tabs?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** horizontal inset of the title row (时间线页传 px-5 与发现页对齐) */
  paddingClass?: string;
  /** extra classes for the title row (博文详情传 py-3 加高作者卡) */
  rowClassName?: string;
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
      <div className={cn("flex min-h-12 items-center gap-3 py-1.5", paddingClass, rowClassName)}>
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
          {title && <h1 className="truncate text-[19px] font-normal leading-tight">{title}</h1>}
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
      {tabs}
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
