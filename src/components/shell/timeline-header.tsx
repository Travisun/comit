"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";

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
            className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-hover"
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
            : "text-muted-foreground hover:bg-hover hover:text-foreground",
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
