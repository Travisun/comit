"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoFull } from "@/components/brand/logo";
import { ArrowLeft, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Console sidebar — fixed full-height left column, Stripe new-chrome style:
 * white surface, the brand wordmark on top, grouped nav, and a single
 * vertical hairline separating it from the right-hand area (whose sticky
 * header carries the account menu). Mobile: slide-in drawer.
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
        "flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
        active
          ? "bg-[var(--selected)] font-medium text-foreground"
          : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 2} />
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
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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

function BackToSiteLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
    >
      <ArrowLeft className="size-4 shrink-0" />
      返回网站
    </Link>
  );
}

function BrandMark() {
  return (
    <span className="inline-flex select-none items-center px-1.5" role="img" aria-label="comit.sh">
      <LogoFull height={18} />
    </span>
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
      {/* desktop rail — fixed full-height white column; a single vertical
          hairline ("one line splits the app in two") separates it from the
          right-hand area, whose sticky header carries the account menu */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-[var(--background)] shadow-[inset_-1px_0_var(--border)] lg:flex">
        <div className="flex h-11 shrink-0 items-center px-3">
          <BrandMark />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-5">
          <NavGroups groups={groups} />
        </div>
        <div className="shrink-0 p-2.5">
          <BackToSiteLink />
        </div>
      </aside>

      {/* mobile drawer + overlay */}
      <div
        className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-[rgba(79,86,107,0.25)] transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={sectionLabel}
          className={cn(
            "absolute inset-y-0 left-0 flex w-64 flex-col bg-[var(--background)] shadow-[inset_-1px_0_var(--border)] transition-transform duration-200 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-3 pr-2">
            <BrandMark />
            <button
              type="button"
              aria-label="关闭菜单"
              onClick={onClose}
              className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
            >
              <X className="size-4.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <NavGroups groups={groups} onNavigate={onClose} />
          </div>
          <div className="shrink-0 p-2.5">
            <BackToSiteLink onNavigate={onClose} />
          </div>
        </aside>
      </div>
    </>
  );
}
