"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isAuthError, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";

/** 组件本地乐观状态（缓存承载）；无对应服务端列表键，故不入 queryKeys 工厂 */
interface RepostState {
  reposted: boolean;
  count: number;
}

export function RepostButton({
  postId,
  initialCount,
  initialReposted,
  className,
}: {
  postId: string;
  initialCount: number;
  initialReposted: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");

  // 转发状态放查询缓存：optimistic 先翻转、失败自动回滚快照。
  const stateKey = useMemo(() => ["repost", postId] as const, [postId]);
  const { data } = useQuery({
    queryKey: stateKey,
    queryFn: (): RepostState => ({ reposted: initialReposted, count: initialCount }),
    initialData: { reposted: initialReposted, count: initialCount },
    staleTime: Infinity,
  });
  const reposted = data.reposted;
  const count = data.count;

  const toggleMutation = useApiMutation(
    (withComment?: string) =>
      postJson<RepostState>("/api/reposts", {
        postId,
        comment: withComment?.trim() ? withComment.trim() : undefined,
      }),
    {
      // 无关系查询键可失效 → 默认 RSC refresh 兜底页面上的服务端计数
      optimistic: {
        queryKey: stateKey,
        apply: (prev) => {
          const p = (prev ?? { reposted: initialReposted, count: initialCount }) as RepostState;
          return {
            reposted: !p.reposted,
            count: Math.max(0, p.count + (p.reposted ? -1 : 1)),
          };
        },
      },
      onSuccess: (r) => {
        queryClient.setQueryData<RepostState>(stateKey, { reposted: r.reposted, count: r.count });
        setOpen(false);
        setComment("");
      },
      onError: (err) => {
        if (isAuthError(err)) setOpen(false);
      },
    },
  );

  function toggle(withComment?: string) {
    if (toggleMutation.pending) return;
    void toggleMutation.mutate(withComment);
  }

  function onClick() {
    if (reposted) {
      // already reposted → click cancels directly
      toggle();
    } else {
      setOpen(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={toggleMutation.pending}
        aria-pressed={reposted}
        title={reposted ? t("post.reposted") : t("post.repost")}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500",
        "disabled:pointer-events-none disabled:opacity-60",
        reposted && "text-emerald-600 hover:text-emerald-600",
        className,
      )}
      >
        <Repeat2 className="size-4 shrink-0" />
        {count > 0 ? (
          <span className="tabular-nums">{count}</span>
        ) : (
          <span className="hidden sm:inline">{t("post.repost")}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("post.repost")}</DialogTitle>
            <DialogDescription>{t("post.reposted")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder={t("feed.composePlaceholder")}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={() => toggle(comment)} disabled={toggleMutation.pending}>
              {t("post.repost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
