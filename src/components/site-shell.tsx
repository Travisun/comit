"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLocalUnread, type LocalUnread } from "@/components/user-space/use-local-unread";
import { LeftNav } from "@/components/shell/left-nav";
import { MobileTabBar, MobileTopBar } from "@/components/shell/mobile-chrome";
import { BrandMark } from "@/components/shell/brand";
import { TimelineHeader, UnderlineTabs } from "@/components/shell/timeline-header";
import type { ShellUser } from "@/components/shell/types";
import { EXTENSION_PAGES } from "@/extensions/_boot/registry";

/**
 * SiteShell 组合根 — 前台三栏布局的装配点。布局子件抽离在
 * `@/components/shell/*`：brand（品牌/创作入口）、left-nav（桌面导航）、
 * mobile-chrome（移动顶栏/底部标签）、timeline-header（时间线页头）、
 * user-menu（账号菜单）。新增布局能力请改对应子件，本文件只做装配。
 */

export type { ShellUser, LocalUnread };
export { BrandMark, TimelineHeader, UnderlineTabs };

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

/**
 * Route prefixes that render without the social chrome (centered card pages).
 * /auth 不在此列——它已迁入独立 (auth) 路由组，裸页由 src/app/(auth)/layout.tsx
 * 结构化表达；这里只剩仍位于 (site) 组内的裸页（/legal、/about）。
 */
const BARE_PREFIXES = ["/legal", "/about"];

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

  // 扩展页面可选 bare 布局（无三栏壳；/auth 裸页已由 (auth) 路由组承担）
  const extPage = pathname.startsWith("/e/")
    ? EXTENSION_PAGES.find((p) => pathname === `/e/${p.path}`)
    : null;
  const bare = BARE_PREFIXES.some((p) => pathname.startsWith(p)) || extPage?.layout === "bare";
  if (bare) return <>{children}</>;

  // app-surface pages (messenger) take the full panel width without the rail
  const isFullWidth = pathname.startsWith("/messages");

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)] md:h-dvh md:overflow-hidden">
      <MobileTopBar user={user} isAdmin={isAdmin} siteName={siteName} locale={locale} />

      {/* two columns: icon/text nav | main zone. The main zone's panel spans
          to the container's right edge and splits into content | rail. */}
      <div className="mx-auto flex h-full w-full max-w-[1280px]">
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
              <div className="lg:hidden">{footer}</div>
            </div>

            {/* right rail — merged into the panel as its own scroll column (xl only) */}
            {rail != null && (
              <aside className="hidden w-[320px] shrink-0 border-l border-border lg:flex lg:flex-col">
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
