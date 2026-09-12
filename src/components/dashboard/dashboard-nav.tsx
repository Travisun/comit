"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  Database,
  FileText,
  Globe,
  KeyRound,
  PenLine,
  ShieldCheck,
  Ticket,
  UserRound,
  Webhook,
} from "lucide-react";
import { ConsoleTopbar } from "./console-topbar";
import {
  ConsoleSidebar,
  type ConsoleNavGroup,
  type ConsoleNavItem,
} from "./console-sidebar";

/**
 * 创作中心 console shell — full-width top bar (wordmark + breadcrumb + bell +
 * avatar) above a sticky left sidebar with uppercase section labels and
 * rounded active items. Mobile: sidebar becomes a slide-in drawer.
 */

export interface DashboardNavItem extends ConsoleNavItem {
  /** English label (legacy compat — used when locale === "en"). */
  en?: string;
}

export interface DashboardNavGroup {
  label: string;
  en: string;
  items: DashboardNavItem[];
}

const WRITE_GROUP: DashboardNavGroup = {
  label: "写作",
  en: "Write",
  items: [
    { href: "/write", label: "写文章", en: "Write", icon: PenLine, exact: true },
    { href: "/write/posts", label: "我的文章", en: "My posts", icon: FileText },
  ],
};

const ACCOUNT_ITEMS: DashboardNavItem[] = [
  { href: "/settings/profile", label: "资料", en: "Profile", icon: UserRound },
  { href: "/settings/security", label: "安全", en: "Security", icon: ShieldCheck },
  { href: "/settings/notifications", label: "通知", en: "Notifications", icon: Bell },
  { href: "/settings/subdomain", label: "子域名", en: "Subdomain", icon: Globe },
  { href: "/settings/invites", label: "邀请码", en: "Invites", icon: Ticket },
  { href: "/settings/verification", label: "认证", en: "Verification", icon: BadgeCheck },
  { href: "/settings/webhooks", label: "Webhook", en: "Webhooks", icon: Webhook },
  { href: "/settings/tokens", label: "API · MCP", en: "API · MCP", icon: KeyRound },
  { href: "/settings/data", label: "数据与导出", en: "Data & export", icon: Database },
];

export function DashboardNav({
  displayName,
  username,
  avatarPath,
  showSubdomain = false,
  locale = "zh",
  children,
}: {
  displayName: string;
  username: string;
  avatarPath: string | null;
  showSubdomain?: boolean;
  locale?: "zh" | "en";
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const accountItems = ACCOUNT_ITEMS.filter((i) => showSubdomain || i.href !== "/settings/subdomain");
  const groups: ConsoleNavGroup[] = useMemo(
    () => [
      { label: locale === "en" ? WRITE_GROUP.en : WRITE_GROUP.label, items: WRITE_GROUP.items },
      {
        label: locale === "en" ? "Account" : "账户设置",
        items: accountItems.map((i) => ({ ...i, label: locale === "en" ? (i.en ?? i.label) : i.label })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountItems derives from constants + showSubdomain only
    [showSubdomain, locale],
  );

  // breadcrumb: first nav item whose route prefix matches the current path
  const breadcrumb = useMemo(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.label;
      }
    }
    return undefined;
  }, [groups, pathname]);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[var(--background)]">
      <ConsoleTopbar
        section={locale === "en" ? "Console" : "创作中心"}
        displayName={displayName}
        username={username}
        avatarPath={avatarPath}
        onMenuClick={() => setMenuOpen(true)}
      />
      <div className="flex w-full flex-1">
        <ConsoleSidebar
          groups={groups}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          sectionLabel={locale === "en" ? "Console" : "创作中心"}
        />
        <main className="min-w-0 flex-1 bg-[var(--muted)]">{children}</main>
      </div>
    </div>
  );
}
