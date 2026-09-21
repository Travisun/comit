"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { History } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
} from "@/components/ui/primitives";
import { EmptyState, PageHeader, Pagination, TableSkeleton, TableWrap } from "@/components/admin/bits";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { routes } from "@/core/routes";

/* -------------------------------- schema --------------------------------- */

const auditItemSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  targetUsername: z.string().nullable(),
  // post 目标的 canonical permalink 用（/post/{publicId}；uuid 已不兼容）
  targetPublicId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  adminId: z.string().nullable(),
  // 系统 actor 的审计行 adminId 为 null（leftJoin），三个 admin* 字段随之可空
  adminUsername: z.string().nullable(),
  adminDisplayName: z.string().nullable(),
  adminAvatar: z.string().nullable(),
});

const auditPageSchema = z.object({
  items: z.array(auditItemSchema),
  total: z.number(),
  // 动作分面（全局统计）随每页响应一起返回，供筛选下拉合并
  actions: z.array(z.object({ action: z.string(), count: z.number() })),
});

type AuditItem = z.infer<typeof auditItemSchema>;

const PAGE_SIZE = 40;

/** Common action groups keep the dropdown readable even with many action types. */
const COMMON_ACTIONS = [
  { value: "", label: "全部动作" },
  { value: "user.warn", label: "用户 · 警告" },
  { value: "user.ban_timed", label: "用户 · 限时封禁" },
  { value: "user.ban_permanent", label: "用户 · 永久封禁" },
  { value: "user.unban", label: "用户 · 解封" },
  { value: "user.role", label: "用户 · 角色变更" },
  { value: "user.status", label: "用户 · 状态变更" },
  { value: "report.resolve", label: "举报 · 处理完成" },
  { value: "report.dismiss", label: "举报 · 忽略" },
  { value: "report.delete_content", label: "举报 · 删除内容" },
  { value: "report.ban_author", label: "举报 · 封禁作者" },
  { value: "report.warn_author", label: "举报 · 警告作者" },
  { value: "media.delete", label: "媒体 · 删除" },
  { value: "invite.revoke", label: "邀请码 · 作废" },
];

/** Action → badge variant, grouped by prefix for quick visual scanning. */
function ActionBadge({ action }: { action: string }) {
  const variant = action.startsWith("user.")
    ? "default"
    : action.startsWith("report.")
      ? "warning"
      : action.startsWith("media.") || action.startsWith("invite.")
        ? "outline"
        : "secondary";
  return (
    <Badge variant={variant} className="font-mono text-[11px]">
      {action}
    </Badge>
  );
}

/** Object cell: type + a link when a natural front-end route exists. */
function TargetCell({ row }: { row: AuditItem }) {
  const short = row.targetId ? `${row.targetId.slice(0, 8)}…` : "—";
  if (row.targetType === "post" && row.targetId) {
    return (
      <span className="text-xs">
        <span className="text-muted-foreground">post · </span>
        {row.targetPublicId ? (
          <Link
            href={routes.post(row.targetPublicId)}
            target="_blank"
            className="font-mono text-primary hover:underline"
          >
            {short}
          </Link>
        ) : (
          <span className="font-mono">{short}</span>
        )}
      </span>
    );
  }
  if (row.targetType === "user") {
    return (
      <span className="text-xs">
        <span className="text-muted-foreground">user · </span>
        {row.targetUsername ? (
          <Link
            href={routes.profile(row.targetUsername)}
            target="_blank"
            className="text-primary hover:underline"
          >
            @{row.targetUsername}
          </Link>
        ) : (
          <span className="font-mono">{short}</span>
        )}
      </span>
    );
  }
  return (
    <span className="text-xs">
      <span className="text-muted-foreground">{row.targetType}</span>
      {row.targetId ? <span className="ml-1 font-mono">{short}</span> : null}
    </span>
  );
}

function AuditTable({
  data,
  error,
  offset,
  onPage,
}: {
  data: { items: AuditItem[]; total: number } | undefined;
  error: string | null;
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={8} cols={5} />;
  if (data.items.length === 0)
    return <EmptyState title="暂无审计记录" hint="管理操作发生后会记录在这里" />;

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>对象</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap text-xs text-muted-foreground">
                {timeAgo(row.createdAt, locale)}
              </td>
              <td>
                <span className="flex items-center gap-2">
                  <Avatar className="size-6">
                    {row.adminAvatar ? (
                      <AvatarImage src={`/api/media/file/${row.adminAvatar}`} />
                    ) : null}
                    <AvatarFallback>{(row.adminDisplayName ?? "·").slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <span className="whitespace-nowrap text-sm">
                    {row.adminUsername ? `@${row.adminUsername}` : "system"}
                  </span>
                </span>
              </td>
              <td>
                <ActionBadge action={row.action} />
              </td>
              <td>
                <TargetCell row={row} />
              </td>
              <td className="max-w-md">
                <span className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {row.note ?? "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPage={onPage} />
    </>
  );
}

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);

  const onPage = useCallback((next: number) => setOffset(next), []);

  // 列表 + 动作分面一次取回（服务端每页都带全局 actions 统计，替代原 limit=1 探测请求）
  const auditQ = useQuery({
    ...apiQueryOptions({
      queryKey: queryKeys.adminAudit(action, offset),
      url: `/api/admin/audit?limit=${PAGE_SIZE}&offset=${offset}${action ? `&action=${encodeURIComponent(action)}` : ""}`,
      schema: auditPageSchema,
    }),
    // 筛选/翻页时保留上一页数据，避免表格闪烁回骨架
    placeholderData: keepPreviousData,
  });

  // merge actions discovered in the data (beyond the common groups) into the dropdown
  const extra = (auditQ.data?.actions ?? [])
    .filter((a) => !COMMON_ACTIONS.some((c) => c.value === a.action))
    .map((a) => ({ value: a.action, label: `${a.action} (${a.count})` }));
  const options = [...COMMON_ACTIONS, ...extra];

  return (
    <div>
      <PageHeader
        title="审计日志"
        description="全部敏感操作的只读流水，覆盖用户处置、举报处理、媒体与邀请码操作"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <History className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
            className="h-[30px] w-full appearance-none rounded-md border border-border bg-card pl-8 pr-2.5 text-sm text-[color:var(--text-body)] outline-none transition-colors focus-visible:border-primary"
            aria-label="按动作筛选"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AuditTable
        data={auditQ.data}
        error={auditQ.error instanceof Error ? auditQ.error.message : null}
        offset={offset}
        onPage={onPage}
      />
    </div>
  );
}
