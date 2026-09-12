"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Copy, Search, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/admin/post-actions";
import {
  EmptyState,
  FilterChips,
  PageHeader,
  Pagination,
  StatCard,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface InviteItem {
  id: string;
  code: string;
  createdAt: string;
  usedAt: string | null;
  createdBy: string;
  creatorUsername: string;
  creatorDisplayName: string;
  usedBy: string | null;
  usedByUsername: string | null;
  usedByDisplayName: string | null;
}

const PAGE_SIZE = 30;

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "unused", label: "未使用" },
  { value: "used", label: "已使用" },
] as const;

function InvitesTable({
  filter,
  query,
  offset,
  onPage,
  onChanged,
}: {
  filter: string;
  query: string;
  offset: number;
  onPage: (next: number) => void;
  onChanged: () => void;
}) {
  const { locale } = useI18n();
  const [data, setData] = useState<{
    items: InviteItem[];
    total: number;
    stats: { used: number; unused: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<InviteItem | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      filter,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (query) params.set("q", query);
    api<{ items: InviteItem[]; total: number; stats: { used: number; unused: number } }>(
      `/api/admin/invites?${params}`,
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, query, offset, onChanged]);

  async function revoke(item: InviteItem) {
    setPending(true);
    try {
      await api(`/api/admin/invites/${item.id}`, { method: "DELETE" });
      toast.success(`已作废邀请码 ${item.code}`);
      setRevoking(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "作废失败");
    } finally {
      setPending(false);
    }
  }

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={8} cols={5} />;
  if (data.items.length === 0)
    return <EmptyState title="暂无邀请码" hint="用户可在注册页/设置页生成邀请码" />;

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="邀请码总量" value={data.stats.used + data.stats.unused} icon={<Ticket />} />
        <StatCard label="未使用" value={data.stats.unused} icon={<CircleDashed />} />
        <StatCard label="已使用" value={data.stats.used} icon={<CheckCircle2 />} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th>邀请码</th>
            <th>邀请人</th>
            <th>状态</th>
            <th>使用者</th>
            <th className="text-right">创建时间</th>
            <th className="w-24 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((inv) => {
            const used = inv.usedAt !== null;
            return (
              <tr key={inv.id}>
                <td>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 font-mono text-sm hover:underline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(inv.code)
                        .then(() => toast.success("邀请码已复制"))
                        .catch(() => toast.error("复制失败"));
                    }}
                    title="点击复制"
                  >
                    {inv.code}
                    <Copy className="size-3 text-muted-foreground" />
                  </button>
                </td>
                <td className="text-sm">
                  <a href={`/u/${inv.creatorUsername}`} target="_blank" rel="noreferrer" className="hover:underline">
                    {inv.creatorDisplayName}
                  </a>
                  <span className="text-muted-foreground"> @{inv.creatorUsername}</span>
                </td>
                <td>
                  {used ? (
                    <Badge variant="secondary">已使用</Badge>
                  ) : (
                    <Badge variant="success">未使用</Badge>
                  )}
                </td>
                <td className="text-sm text-muted-foreground">
                  {used && inv.usedByUsername ? (
                    <span>
                      @{inv.usedByUsername}
                      <span className="ml-1 text-xs">· {timeAgo(inv.usedAt!, locale)}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap text-right text-xs text-muted-foreground">
                  {timeAgo(inv.createdAt, locale)}
                </td>
                <td className="text-right">
                  {used ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setRevoking(inv)}
                    >
                      作废
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPage={onPage} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(v) => {
          if (!v) setRevoking(null);
        }}
        title="作废该邀请码？"
        description={
          revoking
            ? `邀请码 ${revoking.code} 将被删除，之后无法再用于注册。此操作会记录在审计日志。`
            : undefined
        }
        confirmText="确认作废"
        destructive
        pending={pending}
        onConfirm={() => {
          if (revoking) void revoke(revoking);
        }}
      />
    </>
  );
}

export default function AdminInvitesPage() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const onPage = useCallback((next: number) => setOffset(next), []);

  return (
    <div>
      <PageHeader title="邀请码总览" description="全站邀请码：使用状态、归属与作废" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索邀请码…"
            className="pl-8"
          />
        </div>
        <div className="flex gap-1.5">
          <FilterChips options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} value={filter} onChange={(v) => { setFilter(v); setOffset(0); }} />
        </div>
      </div>

      <InvitesTable
        key={`${filter}|${query}|${offset}|${version}`}
        filter={filter}
        query={query}
        offset={offset}
        onPage={onPage}
        onChanged={bump}
      />
    </div>
  );
}
