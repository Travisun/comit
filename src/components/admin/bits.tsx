"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/* ------------------------------ page header ----------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/* -------------------------------- badges -------------------------------- */

export function PostStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "published":
      return <Badge variant="success">已发布</Badge>;
    case "pending_review":
      return <Badge variant="warning">待审核</Badge>;
    case "rejected":
      return <Badge variant="destructive">已驳回</Badge>;
    default:
      return <Badge variant="secondary">草稿</Badge>;
  }
}

export function PostTypeBadge({ type }: { type: string }) {
  return type === "short" ? <Badge variant="outline">动态</Badge> : <Badge variant="outline">文章</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  return role === "admin" ? <Badge>管理员</Badge> : <Badge variant="secondary">用户</Badge>;
}

export function UserStatusBadge({ status }: { status: string }) {
  return status === "active" ? (
    <Badge variant="success">正常</Badge>
  ) : (
    <Badge variant="destructive">已封禁</Badge>
  );
}

export function CommentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "hidden":
      return <Badge variant="warning">已隐藏</Badge>;
    case "deleted":
      return <Badge variant="destructive">已删除</Badge>;
    default:
      return <Badge variant="success">显示中</Badge>;
  }
}

export function SeverityBadge({ severity }: { severity: string }) {
  return severity === "block" ? (
    <Badge variant="destructive">禁止</Badge>
  ) : (
    <Badge variant="warning">警告</Badge>
  );
}

/* ------------------------------- stat card ------------------------------ */

export function StatCard({
  label,
  value,
  sub,
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon: ReactNode;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4.5">
        {icon}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="transition-opacity hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ------------------------------ empty state ----------------------------- */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-[var(--muted)] px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-[var(--muted)] text-muted-foreground">
        <Inbox className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------- table skeleton --------------------------- */

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2.5 p-1">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-5", c === 0 ? "w-[28%]" : c === cols - 1 ? "ml-auto w-16" : "w-[14%]")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ pagination ------------------------------ */

export function Pagination({
  offset,
  limit,
  total,
  onPage,
}: {
  offset: number;
  limit: number;
  total: number;
  onPage: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between pt-1">
      <p className="text-xs text-muted-foreground tabular-nums">
        共 {total} 条 · 第 {page}/{pages} 页
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset <= 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onPage(offset + limit)}
        >
          下一页
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ filter chips ----------------------------- */

/**
 * CF-style filter chips: 1px border, rounded-md; the active chip gets an
 * orange border/text on a faint primary wash. `value=""` allowed.
 */
export function FilterChips({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div role="group" className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]"
                : "bg-[var(--muted)] text-[color:var(--text-body)] hover:bg-[var(--hover)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ table shell ----------------------------- */

export function TableWrap({ children }: { children: ReactNode }) {
  return <DataTable>{children}</DataTable>;
}