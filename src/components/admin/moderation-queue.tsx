"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/admin/bits";
import { RejectDialog } from "@/components/admin/post-actions";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface QueueItem {
  id: string;
  title: string | null;
  summary: string;
  content: string;
  type: string;
  createdAt: string;
  rejectReason: string | null;
  moderation: {
    keyword?: { severity: string; hits: string[] };
    llm?: { approved: boolean; score?: number; reason?: string };
    reviewedAt?: string;
    reviewedBy?: string;
  } | null;
  author: { username: string; displayName: string };
}

/** 待审队列：pending_review 文章卡片 + 通过 / 驳回操作。 */
export function ModerationQueueTab() {
  const { locale } = useI18n();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);

  const load = useCallback(() => {
    api<{ items: QueueItem[] }>("/api/admin/moderation/queue?limit=20")
      .then((d) => setItems(d.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(item: QueueItem) {
    setPendingId(item.id);
    try {
      await api(`/api/admin/posts/${item.id}/approve`, { method: "POST" });
      toast.success("已通过审核并发布");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPendingId(null);
    }
  }

  async function reject(item: QueueItem, reason: string) {
    setPendingId(item.id);
    try {
      await api(`/api/admin/posts/${item.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast.success("已驳回");
      setRejectTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPendingId(null);
    }
  }

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!items)
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-[var(--muted)] space-y-2.5 pt-5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-8 w-40" />
          </div>
        ))}
      </div>
    );
  if (items.length === 0)
    return (
      <EmptyState
        title="太棒了，没有待审核的内容"
        hint="新提交的文章进入人工审核后会出现在这里"
      />
    );

  return (
    <>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg bg-[var(--muted)] flex flex-col gap-3 pt-5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <a
                    href={`/p/${item.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold hover:underline"
                  >
                    {item.title ?? "（无标题）"}
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    @{item.author.username} · {item.type === "short" ? "动态" : "文章"} · 提交于{" "}
                    {timeAgo(item.createdAt, locale)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" disabled={pendingId === item.id} onClick={() => approve(item)}>
                    <Check className="size-3.5" />
                    通过
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingId === item.id}
                    onClick={() => setRejectTarget(item)}
                  >
                    <X className="size-3.5" />
                    驳回
                  </Button>
                </div>
              </div>

              {item.summary ? <p className="text-sm text-muted-foreground">{item.summary}</p> : null}
              {item.content ? (
                <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-foreground/90">
                  {item.content}
                  {item.content.length >= 500 ? "…" : ""}
                </p>
              ) : null}

              {/* machine review context */}
              {item.moderation && (item.moderation.keyword || item.moderation.llm) ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
                  <span className="font-medium text-muted-foreground">机审意见：</span>
                  {item.moderation.keyword ? (
                    <Badge variant={item.moderation.keyword.severity === "block" ? "destructive" : "warning"}>
                      命中关键词：{item.moderation.keyword.hits.join("、")}
                    </Badge>
                  ) : null}
                  {item.moderation.llm ? (
                    <Badge variant={item.moderation.llm.approved ? "success" : "destructive"}>
                      LLM {item.moderation.llm.approved ? "通过" : "不通过"}
                      {item.moderation.llm.score !== undefined ? ` · ${item.moderation.llm.score} 分` : ""}
                      {item.moderation.llm.reason ? ` · ${item.moderation.llm.reason}` : ""}
                    </Badge>
                  ) : null}
                  {item.moderation.reviewedBy ? (
                    <span className="text-muted-foreground">
                      ({item.moderation.reviewedBy === "manual" ? "转人工" : item.moderation.reviewedBy})
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
      </div>

      <RejectDialog
        open={rejectTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRejectTarget(null);
        }}
        pending={pendingId !== null}
        onSubmit={(reason) => {
          if (rejectTarget) reject(rejectTarget, reason);
        }}
      />
    </>
  );
}
