"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { routes } from "@/core/routes";
import {
  Check,
  ExternalLink,
  Gavel,
  MessageSquareWarning,
  ShieldAlert,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
} from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, FilterChips, PageHeader, Pagination, TableSkeleton } from "@/components/admin/bits";
import { ConfirmDialog } from "@/components/admin/post-actions";
import {
  PermanentBanDialog,
  TimedBanDialog,
  WarnDialog,
} from "@/components/admin/user-modals";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { postJson } from "@/lib/client/api";
import { timeAgo, truncate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

// 就地 zod schema：/api/admin/reports 响应无现成 schema，进缓存前校验把关
const targetPreviewSchema = z.object({
  kind: z.enum(["post", "comment", "user"]),
  url: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  postStatus: z.string().optional(),
  postId: z.string().optional(),
  postTitle: z.string().optional(),
  username: z.string().optional(),
  displayName: z.string().optional(),
  avatarPath: z.string().nullable().optional(),
  userStatus: z.string().optional(),
  postCount: z.number().optional(),
  createdAt: z.string().optional(),
  missing: z.boolean().optional(),
});

const reportItemSchema = z.object({
  id: z.string(),
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string(),
  reason: z.string(),
  status: z.enum(["open", "resolved", "dismissed"]),
  createdAt: z.string(),
  reporter: z.object({ username: z.string(), displayName: z.string() }),
  targetPreview: targetPreviewSchema,
});

const reportsListSchema = z.object({
  items: z.array(reportItemSchema),
  total: z.number(),
});

type TargetPreview = z.infer<typeof targetPreviewSchema>;
type ReportItem = z.infer<typeof reportItemSchema>;

const PAGE_SIZE = 30;

const STATUS_FILTERS = [
  { value: "open", label: "待处理" },
  { value: "resolved", label: "已处理" },
  { value: "dismissed", label: "已驳回" },
  { value: "all", label: "全部" },
] as const;

const TYPE_FILTERS = [
  { value: "", label: "全部类型" },
  { value: "post", label: "文章" },
  { value: "comment", label: "评论" },
  { value: "user", label: "用户" },
] as const;

function typeLabel(t: string): string {
  return t === "post" ? "文章" : t === "comment" ? "评论" : "用户";
}

function postStatusBadge(status?: string) {
  switch (status) {
    case "published":
      return <Badge variant="success">已发布</Badge>;
    case "pending_review":
      return <Badge variant="warning">待审核</Badge>;
    case "rejected":
      return <Badge variant="destructive">已驳回</Badge>;
    case "deleted":
      return <Badge variant="destructive">已删除</Badge>;
    default:
      return <Badge variant="secondary">草稿</Badge>;
  }
}

/* ---------------------------- target preview ----------------------------- */

function TargetPreviewCard({ p }: { p: TargetPreview }) {
  const { locale } = useI18n();
  if (p.missing) {
    return (
      <div className="rounded-md bg-[var(--muted)] p-3 text-sm text-muted-foreground">
        被举报对象已不存在（可能已被删除或注销）。
      </div>
    );
  }
  if (p.kind === "post") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          {postStatusBadge(p.postStatus)}
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            {p.title}
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </a>
        </div>
        {p.username ? <p className="text-xs text-muted-foreground">作者 @{p.username}</p> : null}
        {p.excerpt ? (
          <p className="line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">{p.excerpt}</p>
        ) : null}
      </div>
    );
  }
  if (p.kind === "comment") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="whitespace-pre-wrap text-sm">{p.excerpt}</p>
        <p className="text-xs text-muted-foreground">
          评论者 {p.username ? `@${p.username} · ` : ""}
          所属文章：
          <a href={p.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {p.postTitle}
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Avatar className="size-10">
        {p.avatarPath ? <AvatarImage src={`/api/media/file/${p.avatarPath}`} /> : null}
        <AvatarFallback>{(p.displayName ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {p.displayName}
          </a>
          <span className="text-xs text-muted-foreground">@{p.username}</span>
          {p.userStatus === "suspended" ? <Badge variant="destructive">已封禁</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          发帖 {p.postCount ?? 0} 篇
          {p.createdAt
            ? ` · 注册于 ${new Date(p.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}`
            : ""}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------- detail ---------------------------------- */

type ReportAction =
  | "resolve"
  | "dismiss"
  | "delete_content"
  | { kind: "ban_timed"; days: number; reason: string }
  | { kind: "ban_permanent"; reason: string }
  | { kind: "warn"; message: string };

/** 把判别联合的处置动作映射为 action 接口的请求体。 */
function buildActionBody(action: ReportAction, note: string): Record<string, unknown> {
  const body: Record<string, unknown> = { note: note || undefined };
  if (typeof action === "string") {
    body.action = action;
  } else if (action.kind === "warn") {
    body.action = "warn_author";
    body.message = action.message;
  } else if (action.kind === "ban_timed") {
    body.action = "ban_author";
    body.banDays = action.days;
    body.reason = action.reason;
  } else {
    body.action = "ban_author";
    body.reason = action.reason;
  }
  return body;
}

function ReportDetail({
  report,
  onAction,
  pending,
}: {
  report: ReportItem;
  onAction: (action: ReportAction, note: string) => void | Promise<void>;
  pending: boolean;
}) {
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [timedOpen, setTimedOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{typeLabel(report.targetType)}</Badge>
        {report.status === "open" ? (
          <Badge variant="warning">待处理</Badge>
        ) : report.status === "resolved" ? (
          <Badge variant="success">已处理</Badge>
        ) : (
          <Badge variant="secondary">已驳回</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {timeAgo(report.createdAt, "zh")}
        </span>
      </div>

      {/* reporter */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">举报人：</span>
        <Link
          href={routes.profile(report.reporter.username)}
          target="_blank"
          className="font-medium hover:underline"
        >
          {report.reporter.displayName} (@{report.reporter.username})
        </Link>
      </div>

      {/* reason */}
      <div className="rounded-md bg-muted/60 p-3 text-sm">
        <span className="text-muted-foreground">举报理由：</span>
        {report.reason}
      </div>

      {/* target inline preview */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          被举报对象
        </p>
        <TargetPreviewCard p={report.targetPreview} />
      </div>

      {/* moderator note */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-note">处置备注（写入审计日志，可选）</Label>
        <Textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="记录处置依据，便于审计回溯"
          rows={2}
        />
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onAction("dismiss", note)}
        >
          <X />
          忽略
        </Button>
        <Button size="sm" disabled={pending} onClick={() => onAction("resolve", note)}>
          <Check />
          处理完成
        </Button>
        {report.targetType !== "user" ? (
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
            删除内容
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <Gavel />
              封禁作者…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setTimedOpen(true)}>
              <Timer />
              限时封禁…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setPermOpen(true)}
            >
              <ShieldAlert />
              永久封禁…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setWarnOpen(true)}>
          <MessageSquareWarning />
          警告作者
        </Button>
      </div>

      {/* nested confirm + moderation dialogs */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除被举报内容？"
        description={
          report.targetType === "post"
            ? "文章将被驳回（作者可见原因），举报自动标记为已处理。"
            : "评论将被软删除（前台不再显示），举报自动标记为已处理。"
        }
        confirmText="确认删除"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirmDelete(false);
          void onAction("delete_content", note);
        }}
      />
      <WarnDialog
        target={{
          id: report.targetId,
          username: report.targetPreview.username ?? "author",
          displayName: report.targetPreview.displayName,
        }}
        open={warnOpen}
        onOpenChange={setWarnOpen}
        pending={pending}
        onSubmit={(message) => {
          setWarnOpen(false);
          void onAction({ kind: "warn", message }, note);
        }}
      />
      <TimedBanDialog
        target={{
          id: report.targetId,
          username: report.targetPreview.username ?? "author",
          displayName: report.targetPreview.displayName,
        }}
        open={timedOpen}
        onOpenChange={setTimedOpen}
        pending={pending}
        onSubmit={(days, reason) => {
          setTimedOpen(false);
          void onAction({ kind: "ban_timed", days, reason }, note);
        }}
      />
      <PermanentBanDialog
        target={{
          id: report.targetId,
          username: report.targetPreview.username ?? "author",
          displayName: report.targetPreview.displayName,
        }}
        open={permOpen}
        onOpenChange={setPermOpen}
        pending={pending}
        onSubmit={(reason) => {
          setPermOpen(false);
          void onAction({ kind: "ban_permanent", reason }, note);
        }}
      />
    </div>
  );
}

/* ------------------------------- workbench -------------------------------- */

function ReportsWorkbench({
  status,
  type,
  offset,
  onPage,
}: {
  status: string;
  type: string;
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  const [selected, setSelected] = useState<ReportItem | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 队列查询 — key 随筛选/分页变化天然隔离（原 remount-by-key 防竞态 hack
  // 已删）；placeholderData 让切换筛选时保留上一页数据不闪空
  const reportsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminReports(status, type, offset),
      url: `/api/admin/reports?${new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(status !== "all" ? { status } : {}),
        ...(type ? { type } : {}),
      })}`,
      schema: reportsListSchema,
      placeholderData: keepPreviousData,
    }),
  );
  const items = reportsQ.data?.items ?? [];
  const total = reportsQ.data?.total ?? 0;

  // 处置动作 — 成功后失效举报列表 + 相关内容键（删除内容/封禁会影响文章
  // 列表视图）；refresh:false 维持操作台不整页 RSC 重验；错误 toast 文案
  // 与原 toastError 一致
  const actionMutation = useApiMutation(
    (input: { report: ReportItem; action: ReportAction; note: string }) =>
      postJson(
        `/api/admin/reports/${input.report.id}/action`,
        buildActionBody(input.action, input.note),
      ),
    {
      refresh: false,
      invalidate: [queryKeys.adminReportsPrefix(), queryKeys.adminPostsPrefix()],
      successToast: "处置完成",
      onSuccess: () => setSelected(null),
    },
  );

  const runAction = (report: ReportItem, action: ReportAction, note: string) =>
    actionMutation.mutate({ report, action, note });

  if (reportsQ.error) return <EmptyState title="加载失败" hint={reportsQ.error.message} />;
  if (reportsQ.isPending) return <TableSkeleton rows={6} cols={4} />;
  if (items.length === 0)
    return <EmptyState title="没有符合条件的举报" hint="一切正常，保持下去" />;

  const detail = selected ? (
    <ReportDetail
      key={selected.id}
      report={selected}
      onAction={(a, n) => void runAction(selected, a, n)}
      pending={actionMutation.pending}
    />
  ) : (
    <EmptyState title="选择左侧举报查看详情" hint="点击任意一条举报开始处置" />
  );

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* queue — single keyline surface, hairline row separators */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="divide-y divide-border">
              {items.map((r) => {
                const active = selected?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      if (typeof window !== "undefined" && window.innerWidth < 1024) {
                        setMobileOpen(true);
                      }
                    }}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${
                      active ? "bg-primary/5" : "hover:bg-[var(--hover)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{typeLabel(r.targetType)}</Badge>
                      {r.status === "open" ? (
                        <Badge variant="warning">待处理</Badge>
                      ) : r.status === "resolved" ? (
                        <Badge variant="success">已处理</Badge>
                      ) : (
                        <Badge variant="secondary">已驳回</Badge>
                      )}
                      <span>{timeAgo(r.createdAt, locale)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm">{r.reason}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      @{r.reporter.username} 举报 ·{" "}
                      {r.targetPreview.missing ? "对象已删除" : truncate(r.targetPreview.title, 30)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPage={onPage} />
        </div>

        {/* detail (desktop) */}
        <div className="hidden lg:block">
          <div className="sticky top-20">{detail}</div>
        </div>
      </div>

      {/* detail (mobile dialog) */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="max-w-xl">
          {selected ? (
            <ReportDetail
              key={selected.id}
              report={selected}
              onAction={async (a, n) => {
                // mutate 失败不抛出；移动端弹层在动作收尾后关闭（与原行为一致）
                await runAction(selected, a, n);
                setMobileOpen(false);
              }}
              pending={actionMutation.pending}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminReportsPage() {
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);

  const onPage = (next: number) => setOffset(next);

  return (
    <div>
      <PageHeader title="举报处理操作台" description="队列式处置：预览对象、快捷忽略/删除/封禁/警告" />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <FilterChips
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        />
        <FilterChips
          options={TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          value={type}
          onChange={(v) => {
            setType(v);
            setOffset(0);
          }}
        />
      </div>

      <ReportsWorkbench status={status} type={type} offset={offset} onPage={onPage} />
    </div>
  );
}
