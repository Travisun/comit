"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  FileText,
  Flag,
  Images,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { ConsoleTopbar } from "@/components/dashboard/console-topbar";
import {
  ConsoleSidebar,
  type ConsoleNavGroup,
  type ConsoleNavItem,
} from "@/components/dashboard/console-sidebar";

/**
 * Admin console shell — same treatment as the creator console (console-topbar
 * + console-sidebar): top bar with 管理后台 breadcrumb, sticky left rail with
 * grouped/labelled sections and rounded active items, plus a mobile drawer.
 * Keeps ADMIN_NAV_ITEMS / AdminNav({ role }) compatible.
 */

type AdminNavItem = (typeof ADMIN_NAV_ITEMS)[number];

function itemLabel(item: AdminNavItem, t: (key: AdminNavItem["labelKey"]) => string): string {
  return "label" in item && item.label ? item.label : t(item.labelKey);
}

export const ADMIN_NAV_ITEMS = [
  { href: "/admin", labelKey: "admin.dashboard", icon: LayoutDashboard, exact: true, roles: ["admin", "editor"] },
  { href: "/admin/articles", labelKey: "admin.articles", icon: FileText, exact: false, roles: ["admin", "editor"] },
  { href: "/admin/moderation", labelKey: "admin.moderation", icon: ShieldCheck, exact: false, roles: ["admin", "editor"] },
  { href: "/admin/comments", labelKey: "admin.comments", icon: MessageSquare, exact: false, roles: ["admin", "editor"] },
  { href: "/admin/reports", labelKey: "admin.reports", icon: Flag, exact: false, roles: ["admin", "editor"] },
  { href: "/admin/verification", labelKey: "admin.verification", icon: BadgeCheck, exact: false, roles: ["admin", "editor"] },
  { href: "/admin/users", labelKey: "admin.users", icon: Users, exact: false, roles: ["admin"] },
  { href: "/admin/settings", labelKey: "admin.settings", icon: Settings, exact: false, roles: ["admin"] },
  // media / audit / invites panels (admin only); label override keeps them independent of the i18n dict
  { href: "/admin/media", labelKey: "admin.dashboard", label: "媒体管理", icon: Images, exact: false, roles: ["admin"] },
  { href: "/admin/audit", labelKey: "admin.dashboard", label: "审计日志", icon: ScrollText, exact: false, roles: ["admin"] },
  { href: "/admin/invites", labelKey: "admin.dashboard", label: "邀请码", icon: Ticket, exact: false, roles: ["admin"] },
  // ops panel (admin only); label override keeps it independent of the i18n dict
  { href: "/admin/ops", labelKey: "admin.dashboard", label: "运维监控", icon: Activity, exact: false, roles: ["admin"] },
] as const;

/** Section groupings for the CF-style rail (label override entries stay i18n-free). */
const ADMIN_NAV_SECTIONS: {
  label: string;
  hrefs: string[];
}[] = [
  { label: "概览", hrefs: ["/admin", "/admin/articles"] },
  { label: "审核", hrefs: ["/admin/moderation", "/admin/comments", "/admin/reports", "/admin/verification"] },
  { label: "用户", hrefs: ["/admin/users"] },
  { label: "站点", hrefs: ["/admin/settings", "/admin/media", "/admin/audit", "/admin/invites", "/admin/ops"] },
];

export function AdminNav({
  role = "admin",
  displayName,
  username,
  avatarPath,
  children,
}: {
  role?: string;
  displayName: string;
  username: string;
  avatarPath: string | null;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = ADMIN_NAV_ITEMS.filter((i) => (i.roles as readonly string[]).includes(role));

  const groups: ConsoleNavGroup[] = useMemo(
    () =>
      ADMIN_NAV_SECTIONS.map((section) => ({
        label: section.label,
        items: section.hrefs
          .map((href) => items.find((i) => i.href === href))
          .filter((i): i is AdminNavItem => Boolean(i))
          .map((i) => ({ href: i.href, label: itemLabel(i, t), icon: i.icon, exact: i.exact })),
      })).filter((g) => g.items.length > 0),
    [items, t],
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
        section={t("admin.title")}
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
          sectionLabel={t("admin.title")}
        />
        <main className="min-w-0 flex-1 bg-[var(--muted)]">
          <div className="mx-auto w-full max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export type { ConsoleNavItem };
