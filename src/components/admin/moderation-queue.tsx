"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/admin/bits";
import { RejectDialog } from "@/components/admin/post-actions";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";

/* -------------------------------- schema --------------------------------- */

const queueItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  summary: z.string(),
  content: z.string(),
  type: z.string(),
  createdAt: z.string(),
  rejectReason: z.string().nullable(),
  // posts.moderation jsonb — 机审上下文，键均可选，整体可空
  moderation: z
    .object({
      keyword: z.object({ severity: z.string(), hits: z.array(z.string()) }).optional(),
      llm: z
        .object({
          approved: z.boolean(),
          score: z.number().optional(),
          reason: z.string().optional(),
        })
        .optional(),
      reviewedAt: z.string().optional(),
      reviewedBy: z.string().optional(),
    })
    .nullable(),
  author: z.object({ username: z.string(), displayName: z.string() }),
});

const queueSchema = z.object({ items: z.array(queueItemSchema) });

type QueueItem = z.infer<typeof queueItemSchema>;

/** 待审队列：pending_review 文章卡片 + 通过 / 驳回操作。 */
export function ModerationQueueTab() {
  const { locale } = useI18n();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);

  // 队列查询 — 通过/驳回后 invalidate 重取，等价原 load()
  const queueQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminModerationQueue(),
      url: "/api/admin/moderation/queue?limit=20",
      schema: queueSchema,
    }),
  );
  const items = queueQ.data?.items;
  const error = queueQ.error instanceof Error ? queueQ.error.message : null;

  // pendingId 只服务「目标行按钮禁用」的行级 UI（useApiMutation 的 pending 是全局的）
  const approveMutation = useApiMutation(
    (item: QueueItem) => postJson(`/api/admin/posts/${item.id}/approve`, {}),
    {
      refresh: false,
      invalidate: [queryKeys.adminModerationQueue()],
      successToast: "已通过审核并发布",
      onSuccess: () => setPendingId(null),
      onError: () => setPendingId(null),
    },
  );

  const rejectMutation = useApiMutation(
    (input: { item: QueueItem; reason: string }) =>
      postJson(`/api/admin/posts/${input.item.id}/reject`, { reason: input.reason }),
    {
      refresh: false,
      invalidate: [queryKeys.adminModerationQueue()],
      successToast: "已驳回",
      onSuccess: () => {
        setRejectTarget(null);
        setPendingId(null);
      },
      onError: () => setPendingId(null),
    },
  );

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
                  <Button
                    size="sm"
                    disabled={pendingId === item.id}
                    onClick={() => {
                      setPendingId(item.id);
                      void approveMutation.mutate(item);
                    }}
                  >
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
          if (rejectTarget) {
            setPendingId(rejectTarget.id);
            void rejectMutation.mutate({ item: rejectTarget, reason });
          }
        }}
      />
    </>
  );
}
