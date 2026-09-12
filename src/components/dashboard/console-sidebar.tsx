"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogoPlaceholder } from "./console-topbar";

/**
 * Console sidebar — shared by 创作中心 and 管理后台.
 * Desktop (lg+): sticky left rail (w-60) with uppercase 11px section labels,
 * active item = --selected wash + rounded-md. Mobile: slide-in drawer (fixed,
 * w-64, overlay) controlled by the parent's `open` state.
 */

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export interface ConsoleNavGroup {
  label: string;
  items: ConsoleNavItem[];
}

export function useConsoleActive(href: string, exact?: boolean): boolean {
  const pathname = usePathname();
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** One nav row — shared active/inactive treatment for rail and drawer. */
export function ConsoleNavLink({
  item,
  onNavigate,
}: {
  item: ConsoleNavItem;
  onNavigate?: () => void;
}) {
  const active = useConsoleActive(item.href, item.exact);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-[var(--selected,#eef4fb)] font-semibold text-foreground"
          : "text-muted-foreground hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavGroups({
  groups,
  onNavigate,
}: {
  groups: ConsoleNavGroup[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-4 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <ConsoleNavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function ConsoleSidebar({
  groups,
  open,
  onClose,
  sectionLabel = "控制台",
}: {
  groups: ConsoleNavGroup[];
  /** Mobile drawer open state (no-op on desktop). */
  open: boolean;
  onClose: () => void;
  /** Drawer header caption, e.g. 创作中心 / 管理后台. */
  sectionLabel?: string;
}) {
  // lock body scroll while the drawer is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-border bg-white lg:block p-3 lg:p-4">
        <NavGroups groups={groups} />
      </aside>

      {/* mobile drawer + overlay */}
      <div
        className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-foreground/40 transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={sectionLabel}
          className={cn(
            "absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-white transition-transform duration-200 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <BrandLogoPlaceholder />
            <button
              type="button"
              aria-label="关闭菜单"
              onClick={onClose}
              className="-mr-1.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground"
            >
              <X className="size-4.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <NavGroups groups={groups} onNavigate={onClose} />
          </div>
          <div className="shrink-0 border-t border-border p-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground"
            >
              返回网站
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}