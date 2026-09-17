"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
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
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { deleteJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";

/* -------------------------------- schema --------------------------------- */

const inviteItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  createdAt: z.string(),
  usedAt: z.string().nullable(),
  createdBy: z.string(),
  creatorUsername: z.string(),
  creatorDisplayName: z.string(),
  usedBy: z.string().nullable(),
  usedByUsername: z.string().nullable(),
  usedByDisplayName: z.string().nullable(),
});

const invitesPageSchema = z.object({
  items: z.array(inviteItemSchema),
  total: z.number(),
  stats: z.object({ used: z.number(), unused: z.number() }),
});

type InviteItem = z.infer<typeof inviteItemSchema>;

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
}: {
  filter: string;
  query: string;
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  const [revoking, setRevoking] = useState<InviteItem | null>(null);

  // 列表查询 — key 随筛选/搜索/分页变化；placeholderData 保留上一页数据防闪
  const invitesQ = useQuery({
    ...apiQueryOptions({
      queryKey: queryKeys.adminInvites(filter, query, offset),
      url: `/api/admin/invites?filter=${encodeURIComponent(filter)}&limit=${PAGE_SIZE}&offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
      schema: invitesPageSchema,
    }),
    placeholderData: keepPreviousData,
  });
  const data = invitesQ.data;
  const error = invitesQ.error instanceof Error ? invitesQ.error.message : null;

  // 作废 — pending 驱动确认按钮；失效本页列表家族替代原 onChanged 重挂
  const revokeMutation = useApiMutation(
    (item: InviteItem) => deleteJson(`/api/admin/invites/${item.id}`),
    {
      refresh: false,
      invalidate: [queryKeys.adminInvitesPrefix()],
      onSuccess: (_data, item) => {
        toast.success(`已作废邀请码 ${item.code}`);
        setRevoking(null);
      },
    },
  );

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
        pending={revokeMutation.pending}
        onConfirm={() => {
          if (revoking) void revokeMutation.mutate(revoking);
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

  // 搜索防抖：输入先入 q，350ms 后同步进 queryKey 并回到第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const onPage = (next: number) => setOffset(next);

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

      <InvitesTable filter={filter} query={query} offset={offset} onPage={onPage} />
    </div>
  );
}
