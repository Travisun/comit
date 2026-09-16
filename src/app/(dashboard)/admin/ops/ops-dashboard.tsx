"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  Activity,
  Database,
  FileText,
  Flag,
  HardDrive,
  Inbox,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableHead,
  DataTableBody,
  DataTableRow,
  DataTableTh,
  DataTableTd,
  DataTableNum,
} from "@/components/ui/table";
import { EmptyState, PageHeader, StatCard } from "@/components/admin/bits";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { apiQueryOptions } from "@/lib/query/options";

/**
 * Ops panel — pulls /api/admin/ops (read-only snapshot). Refresh is manual
 * only (no polling) to keep the cluster quiet; see docs/concurrency.md for
 * the topology this page describes.
 *
 * Stripe Dashboard layout: bare section headers on the white page, keyline
 * stat tiles, hairline data tables — no card-in-card panels, no shadows.
 */

/* -------------------------------- schema --------------------------------- */

const opsSchema = z.object({
  process: z.object({
    worker: z.string(),
    pid: z.number(),
    uptimeSec: z.number(),
    rss: z.number(),
    heapUsed: z.number(),
    heapTotal: z.number(),
    nodeVersion: z.string(),
  }),
  db: z.object({
    users: z.number(),
    posts: z.number(),
    comments: z.number(),
    media: z.number(),
    notifications: z.number(),
    webhookDeliveries: z.number(),
    reports: z.number(),
    exportJobs: z.number(),
  }),
  queue: z.object({
    byState: z.array(z.object({ queue: z.string(), state: z.string(), n: z.number() })),
    createdLast24h: z.number(),
    statesHint: z.array(z.string()),
  }),
  content: z.object({
    pendingReview: z.number(),
    openReports: z.number(),
    newUsers24h: z.number(),
    newPosts24h: z.number(),
  }),
  storage: z.object({
    media: z.object({ bytes: z.number(), files: z.number(), complete: z.boolean() }),
    exports: z.object({ bytes: z.number(), files: z.number(), complete: z.boolean() }),
    budgetMs: z.number(),
  }),
  collectedInMs: z.number(),
});

type OpsData = z.infer<typeof opsSchema>;

/** 查询键 — keys.ts 冻结期内就地字面量（暂未入厂）；手动刷新走 refetch()。 */
const OPS_KEY = ["admin", "ops"] as const;

interface QueueRow {
  queue: string;
  pending: number; // created + retry — waiting to run
  active: number;
  failed: number; // failed + expired + cancelled — needs attention
  completed: number;
}

function aggregateQueues(rows: OpsData["queue"]["byState"]): QueueRow[] {
  const map = new Map<string, QueueRow>();
  for (const r of rows) {
    let q = map.get(r.queue);
    if (!q) {
      q = { queue: r.queue, pending: 0, active: 0, failed: 0, completed: 0 };
      map.set(r.queue, q);
    }
    switch (r.state) {
      case "created":
      case "retry":
        q.pending += r.n;
        break;
      case "active":
        q.active += r.n;
        break;
      case "completed":
        q.completed += r.n;
        break;
      default:
        q.failed += r.n;
    }
  }
  return [...map.values()].sort((a, b) => a.queue.localeCompare(b.queue));
}

/** Queue health — semantic Badge tone (正常=success / 降级=warning / 异常=destructive). */
function queueHealth(pending: number): { variant: "success" | "warning" | "destructive"; label: string } {
  if (pending > 50) return { variant: "destructive", label: "异常" };
  if (pending > 10) return { variant: "warning", label: "降级" };
  return { variant: "success", label: "正常" };
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分${sec % 60}秒`;
}

/* ------------------------------ primitives ------------------------------ */

/** Bare section header on the white page (no card box). */
function SectionHeader({
  icon,
  title,
  description,
  extra,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        {title}
        {extra}
      </h3>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** Keyline white stat tile — the only boxed surface allowed (Stripe Home stat). */
function StatTile({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">{children}</code>;
}

/* ------------------------------ dashboard ------------------------------- */

export function OpsDashboard() {
  const { locale } = useI18n();

  // 快照查询 — 不自动轮询；「刷新」按钮走 refetch()，isFetching 覆盖首次加载
  // staleTime 用全局默认（15s），手动 refetch 不受 staleTime 约束
  const opsQ = useQuery(
    apiQueryOptions({
      queryKey: OPS_KEY,
      url: "/api/admin/ops",
      schema: opsSchema,
    }),
  );
  const data = opsQ.data;
  const error = opsQ.error instanceof Error ? opsQ.error.message : null;
  const refreshing = opsQ.isFetching;
  const refreshedAt = opsQ.dataUpdatedAt
    ? new Date(opsQ.dataUpdatedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
        hour12: false,
      })
    : null;

  const queues = data ? aggregateQueues(data.queue.byState) : [];
  const totalPending = queues.reduce((s, q) => s + q.pending, 0);
  const totalTone =
    totalPending > 50 ? "destructive" : totalPending > 10 ? "warning" : "success";

  return (
    <div>
      <PageHeader
        title="运维监控"
        description="进程 / 数据库 / 队列 / 内容健康 只读快照（不自动轮询，手动刷新）"
        actions={
          <div className="flex items-center gap-3">
            {refreshedAt ? (
              <span className="text-xs text-muted-foreground tabular-nums">更新于 {refreshedAt}</span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void opsQ.refetch()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              刷新
            </Button>
          </div>
        }
      />

      {error ? (
        <EmptyState title="加载失败" hint={error} />
      ) : !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {/* -------- cluster topology note (bare text, no panel) -------- */}
          <section className="space-y-2">
            <SectionHeader
              icon={<Server />}
              title="集群拓扑"
              description="本面板展示的是「处理这次请求的 worker」的进程视角；多 worker 部署时各卡数值仅代表单进程。"
            />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                拓扑：<Code>WEB_CONCURRENCY</Code> 个 worker 进程，每个 worker = 1 × Next.js SSR
                服务 + 1 × pg-boss 消费者（同一队列竞争消费）；master 进程只负责 fork/重生，不入流量路径。
              </p>
              <p>
                队列在 PostgreSQL <Code>pgboss.job</Code>{" "}
                表中持久化，worker 崩溃后任务由其他 worker 接管；扩容参数与压测方法见{" "}
                <Code>docs/concurrency.md</Code>
                ，部署与告警阈值见 <Code>docs/operations.md</Code>。
              </p>
            </div>
          </section>

          {/* -------- database -------- */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Database />}
              title="数据库 · 核心表行数"
              description="只读统计，单位为行数"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile>
                <StatCard label="users" value={data.db.users} sub="注册用户" icon={<Users />} />
              </StatTile>
              <StatTile>
                <StatCard
                  label="posts"
                  value={data.db.posts}
                  sub="全部内容（含草稿）"
                  icon={<FileText />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="comments"
                  value={data.db.comments}
                  sub="展示中的评论"
                  icon={<MessageSquare />}
                />
              </StatTile>
              <StatTile>
                <StatCard label="media" value={data.db.media} sub="媒体记录" icon={<HardDrive />} />
              </StatTile>
              <StatTile>
                <StatCard
                  label="notifications"
                  value={data.db.notifications}
                  sub="站内通知"
                  icon={<Inbox />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="webhook_deliveries"
                  value={data.db.webhookDeliveries}
                  sub="Webhook 投递记录"
                  icon={<Server />}
                />
              </StatTile>
              <StatTile>
                <StatCard label="reports" value={data.db.reports} sub="举报记录" icon={<Flag />} />
              </StatTile>
              <StatTile>
                <StatCard
                  label="export_jobs"
                  value={data.db.exportJobs}
                  sub="数据导出任务"
                  icon={<Activity />}
                />
              </StatTile>
            </div>
          </section>

          {/* -------- queue -------- */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Server />}
              title="队列 · pgboss.job 深度"
              description={`近 24h 入队 ${data.queue.createdLast24h} · 阈值 >10 降级 / >50 异常`}
              extra={
                <Badge variant={totalTone} className="tabular-nums">
                  待处理合计 {totalPending}
                </Badge>
              }
            />
            {queues.length === 0 ? (
              <EmptyState
                title="pgboss.job 当前为空"
                hint="队列消费正常或尚未产生任务"
              />
            ) : (
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableTh>队列</DataTableTh>
                    <DataTableTh>状态</DataTableTh>
                    <DataTableTh className="text-right">待处理</DataTableTh>
                    <DataTableTh className="text-right">执行中</DataTableTh>
                    <DataTableTh className="text-right">失败</DataTableTh>
                    <DataTableTh className="text-right">已完成</DataTableTh>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {queues.map((q) => {
                    const health = queueHealth(q.pending);
                    return (
                      <DataTableRow key={q.queue}>
                        <DataTableTd className="font-medium text-foreground">{q.queue}</DataTableTd>
                        <DataTableTd>
                          <Badge variant={health.variant}>{health.label}</Badge>
                        </DataTableTd>
                        <DataTableNum
                          className={
                            q.pending > 50
                              ? "text-destructive"
                              : q.pending > 10
                                ? "text-warning"
                                : undefined
                          }
                        >
                          {q.pending}
                        </DataTableNum>
                        <DataTableNum>{q.active}</DataTableNum>
                        <DataTableNum className={q.failed > 0 ? "text-destructive" : undefined}>
                          {q.failed}
                        </DataTableNum>
                        <DataTableNum>{q.completed}</DataTableNum>
                      </DataTableRow>
                    );
                  })}
                </DataTableBody>
              </DataTable>
            )}
          </section>

          {/* -------- content health -------- */}
          <section className="space-y-3">
            <SectionHeader
              icon={<ShieldAlert />}
              title="内容健康"
              description="待人工处理的审核与举报积压"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile>
                <StatCard
                  label="待人工审核"
                  value={
                    <span
                      className={
                        data.content.pendingReview > 20 ? "text-warning" : undefined
                      }
                    >
                      {data.content.pendingReview}
                    </span>
                  }
                  sub="pending_review 文章"
                  icon={<FileText />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="待处理举报"
                  value={
                    <span className={data.content.openReports > 20 ? "text-warning" : undefined}>
                      {data.content.openReports}
                    </span>
                  }
                  sub="open 状态举报"
                  icon={<Flag />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="近 24h 新用户"
                  value={data.content.newUsers24h}
                  sub="注册时间在最近一天"
                  icon={<Users />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="近 24h 新内容"
                  value={data.content.newPosts24h}
                  sub="新建文章/动态"
                  icon={<FileText />}
                />
              </StatTile>
            </div>
          </section>

          {/* -------- process -------- */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Activity />}
              title={`进程（worker ${data.process.worker}）`}
              description="当前响应本次请求的 Next.js worker 进程"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile>
                <StatCard
                  label="RSS 常驻内存"
                  value={formatBytes(data.process.rss)}
                  sub={`heapUsed ${formatBytes(data.process.heapUsed)} / heapTotal ${formatBytes(data.process.heapTotal)}`}
                  icon={<Server />}
                />
              </StatTile>
              <StatTile>
                <StatCard
                  label="运行时长"
                  value={uptime(data.process.uptimeSec)}
                  sub={`pid ${data.process.pid} · Node ${data.process.nodeVersion}`}
                  icon={<Activity />}
                />
              </StatTile>
            </div>
          </section>

          {/* -------- storage -------- */}
          <section className="space-y-3">
            <SectionHeader
              icon={<HardDrive />}
              title="存储"
              description={`遍历预算 ${data.storage.budgetMs / 1000}s，超时结果标记为不完整`}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile>
                <StatCard
                  label="storage/media"
                  value={formatBytes(data.storage.media.bytes)}
                  sub={`${data.storage.media.files} 个文件`}
                  icon={<HardDrive />}
                />
                {data.storage.media.complete ? null : (
                  <p className="mt-2">
                    <Badge variant="warning">统计不完整</Badge>
                  </p>
                )}
              </StatTile>
              <StatTile>
                <StatCard
                  label="storage/exports"
                  value={formatBytes(data.storage.exports.bytes)}
                  sub={`${data.storage.exports.files} 个归档`}
                  icon={<HardDrive />}
                />
                {data.storage.exports.complete ? null : (
                  <p className="mt-2">
                    <Badge variant="warning">统计不完整</Badge>
                  </p>
                )}
              </StatTile>
            </div>
          </section>

          <p className="pb-2 text-xs text-muted-foreground">
            采样耗时 {data.collectedInMs}ms · 数据只读不落库 · 队列深度持续 &gt;50 时请检查 worker
            是否存活（GET /api/health）并参考 docs/concurrency.md 扩容。
          </p>
        </div>
      )}
    </div>
  );
}
