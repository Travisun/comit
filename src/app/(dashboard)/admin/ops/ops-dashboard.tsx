"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatCard } from "@/components/admin/bits";
import { api } from "@/components/admin/client";
import { formatBytes } from "@/lib/utils";

/**
 * Ops panel — pulls /api/admin/ops (read-only snapshot). Refresh is manual
 * only (no polling) to keep the cluster quiet; see docs/concurrency.md for
 * the topology this page describes.
 */

interface OpsData {
  process: {
    worker: string;
    pid: number;
    uptimeSec: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    nodeVersion: string;
  };
  db: {
    users: number;
    posts: number;
    comments: number;
    media: number;
    notifications: number;
    webhookDeliveries: number;
    reports: number;
    exportJobs: number;
  };
  queue: {
    byState: { queue: string; state: string; n: number }[];
    createdLast24h: number;
    statesHint: string[];
  };
  content: {
    pendingReview: number;
    openReports: number;
    newUsers24h: number;
    newPosts24h: number;
  };
  storage: {
    media: { bytes: number; files: number; complete: boolean };
    exports: { bytes: number; files: number; complete: boolean };
    budgetMs: number;
  };
  collectedInMs: number;
}

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

function queueTone(pending: number): string | undefined {
  if (pending > 50) return "text-destructive";
  if (pending > 10) return "text-warning";
  return undefined;
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分${sec % 60}秒`;
}

export function OpsDashboard() {
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await api<OpsData>("/api/admin/ops");
      setData(d);
      setError(null);
      setRefreshedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const queues = data ? aggregateQueues(data.queue.byState) : [];
  const totalPending = queues.reduce((s, q) => s + q.pending, 0);

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
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
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
            <Card key={i}>
              <CardContent className="h-24 animate-pulse bg-muted/40" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* -------- cluster topology note -------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">集群拓扑</CardTitle>
              <CardDescription>
                本面板展示的是「处理这次请求的 worker」的进程视角；多 worker 部署时各卡数值仅代表单进程。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                拓扑：<code className="rounded bg-muted px-1.5 py-0.5">WEB_CONCURRENCY</code> 个 worker
                进程，每个 worker = 1 × Next.js SSR 服务 + 1 × pg-boss 消费者（同一队列竞争消费）；
                master 进程只负责 fork/重生，不入流量路径。
              </p>
              <p>
                队列在 PostgreSQL <code className="rounded bg-muted px-1.5 py-0.5">pgboss.job</code>{" "}
                表中持久化，worker 崩溃后任务由其他 worker 接管；扩容参数与压测方法见{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">docs/concurrency.md</code>
                ，部署与告警阈值见 <code className="rounded bg-muted px-1.5 py-0.5">docs/operations.md</code>。
              </p>
            </CardContent>
          </Card>

          {/* -------- database -------- */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Database className="size-4" /> 数据库 · 核心表行数
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="users" value={data.db.users} sub="注册用户" icon={<Users />} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="posts" value={data.db.posts} sub="全部内容（含草稿）" icon={<FileText />} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard
                    label="comments"
                    value={data.db.comments}
                    sub="展示中的评论"
                    icon={<MessageSquare />}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="media" value={data.db.media} sub="媒体记录" icon={<HardDrive />} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="notifications" value={data.db.notifications} sub="站内通知" icon={<Inbox />} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard
                    label="webhook_deliveries"
                    value={data.db.webhookDeliveries}
                    sub="Webhook 投递记录"
                    icon={<Server />}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="reports" value={data.db.reports} sub="举报记录" icon={<Flag />} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard label="export_jobs" value={data.db.exportJobs} sub="数据导出任务" icon={<Activity />} />
                </CardContent>
              </Card>
            </div>
          </section>

          {/* -------- queue -------- */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Server className="size-4" /> 队列 · pgboss.job 深度
              <Badge variant={totalPending > 50 ? "destructive" : totalPending > 10 ? "warning" : "secondary"}>
                待处理合计 {totalPending}
              </Badge>
              <span className="text-xs font-normal">
                近 24h 入队 {data.queue.createdLast24h} · 阈值 &gt;10 黄 / &gt;50 红
              </span>
            </h3>
            {queues.length === 0 ? (
              <Card>
                <CardContent className="pt-5 text-sm text-muted-foreground">
                  pgboss.job 当前为空（队列消费正常或尚未产生任务）。
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {queues.map((q) => (
                  <Card key={q.queue}>
                    <CardContent className="pt-5">
                      <StatCard
                        label={q.queue}
                        value={<span className={queueTone(q.pending)}>{q.pending}</span>}
                        sub={`执行中 ${q.active} · 失败 ${q.failed} · 已完成 ${q.completed}`}
                        icon={<Server />}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* -------- content health -------- */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <ShieldAlert className="size-4" /> 内容健康
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <StatCard
                    label="待人工审核"
                    value={
                      <span className={data.content.pendingReview > 20 ? "text-warning" : undefined}>
                        {data.content.pendingReview}
                      </span>
                    }
                    sub="pending_review 文章"
                    icon={<FileText />}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
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
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard
                    label="近 24h 新用户"
                    value={data.content.newUsers24h}
                    sub="注册时间在最近一天"
                    icon={<Users />}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <StatCard
                    label="近 24h 新内容"
                    value={data.content.newPosts24h}
                    sub="新建文章/动态"
                    icon={<FileText />}
                  />
                </CardContent>
              </Card>
            </div>
          </section>

          {/* -------- process & storage -------- */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">进程（worker {data.process.worker}）</CardTitle>
                <CardDescription>当前响应本次请求的 Next.js worker 进程</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <StatCard
                    label="RSS 常驻内存"
                    value={formatBytes(data.process.rss)}
                    sub={`heapUsed ${formatBytes(data.process.heapUsed)} / heapTotal ${formatBytes(data.process.heapTotal)}`}
                    icon={<Server />}
                  />
                  <StatCard
                    label="运行时长"
                    value={uptime(data.process.uptimeSec)}
                    sub={`pid ${data.process.pid} · Node ${data.process.nodeVersion}`}
                    icon={<Activity />}
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">存储</CardTitle>
                <CardDescription>
                  遍历预算 {data.storage.budgetMs / 1000}s，超时结果标记为不完整
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <StatCard
                    label="storage/media"
                    value={formatBytes(data.storage.media.bytes)}
                    sub={`${data.storage.media.files} 个文件${data.storage.media.complete ? "" : " · 统计不完整"}`}
                    icon={<HardDrive />}
                  />
                  <StatCard
                    label="storage/exports"
                    value={formatBytes(data.storage.exports.bytes)}
                    sub={`${data.storage.exports.files} 个归档${data.storage.exports.complete ? "" : " · 统计不完整"}`}
                    icon={<HardDrive />}
                  />
                </div>
              </CardContent>
            </Card>
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
