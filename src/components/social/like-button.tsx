"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";

/** 组件本地乐观状态（缓存承载）；无对应服务端列表键，故不入 queryKeys 工厂 */
interface LikeState {
  liked: boolean;
  count: number;
}

export function LikeButton({
  targetType,
  targetId,
  initialCount,
  initialLiked,
  className,
}: {
  targetType: "post" | "comment";
  targetId: string;
  initialCount: number;
  initialLiked: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // 点赞状态放查询缓存：useApiMutation 的 optimistic 直接翻转缓存值、
  // 失败自动回滚快照。staleTime Infinity → queryFn 只作首渲种子，不会重发。
  const stateKey = useMemo(
    () => ["like", targetType, targetId] as const,
    [targetType, targetId],
  );
  const { data } = useQuery({
    queryKey: stateKey,
    queryFn: (): LikeState => ({ liked: initialLiked, count: initialCount }),
    initialData: { liked: initialLiked, count: initialCount },
    staleTime: Infinity,
  });
  const liked = data.liked;
  const count = data.count;

  const toggleMutation = useApiMutation(
    () => postJson<LikeState>("/api/likes", { targetType, targetId }),
    {
      // 无关系查询键可失效 → 保留默认 RSC refresh 兜底页面上的服务端计数
      optimistic: {
        queryKey: stateKey,
        apply: (prev) => {
          const p = (prev ?? { liked: initialLiked, count: initialCount }) as LikeState;
          return { liked: !p.liked, count: Math.max(0, p.count + (p.liked ? -1 : 1)) };
        },
      },
      onSuccess: (r) => {
        // 服务端权威值覆盖乐观值（快速连点时以响应为准）
        queryClient.setQueryData<LikeState>(stateKey, { liked: r.liked, count: r.count });
      },
    },
  );

  function toggle() {
    if (toggleMutation.pending) return;
    void toggleMutation.mutate(undefined);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={toggleMutation.pending}
      aria-pressed={liked}
      title={liked ? t("post.unlike") : t("post.like")}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500",
        "disabled:pointer-events-none disabled:opacity-60",
        liked && "text-rose-500 hover:text-rose-500",
        className,
      )}
    >
      <Heart className={cn("size-4 shrink-0", liked && "fill-current")} />
      {count > 0 ? (
        <span className="tabular-nums">{count}</span>
      ) : (
        <span className="hidden sm:inline">{t("post.like")}</span>
      )}
    </button>
  );
}
