"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { isAuthError, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { openLoginDialog } from "@/lib/store/login-dialog";

/**
 * 收藏按钮 — 文章/短动态详情操作栏与时间线行共用。
 * initialBookmarked 为 null（列表行未下发状态）时挂载后拉一次 GET 状态；
 * 游客点击 → 401 → 唤起登录 dialog（/api/bookmarks 已排除全局 401 跳转）。
 */
export function BookmarkButton({
  postId,
  initialBookmarked = false,
  withLabel = false,
  className,
}: {
  postId: string;
  /** false/true = 服务端已下发；null = 未知（自行拉取） */
  initialBookmarked?: boolean | null;
  /** 详情栏用：带「收藏」文字；行内只显示图标 */
  withLabel?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const stateKey = useMemo(() => ["bookmark", postId] as const, [postId]);
  const needsFetch = initialBookmarked === null;
  const { data } = useQuery({
    queryKey: stateKey,
    queryFn: async (): Promise<boolean> => {
      if (!needsFetch) return initialBookmarked as boolean;
      try {
        return (await apiGet<{ bookmarked: boolean }>(`/api/bookmarks?postId=${postId}`))
          .bookmarked;
      } catch {
        return false;
      }
    },
    initialData: needsFetch ? undefined : initialBookmarked,
    staleTime: Infinity,
  });
  const bookmarked = data ?? false;

  const toggleMutation = useApiMutation(
    () => postJson<{ bookmarked: boolean }>("/api/bookmarks", { postId }),
    {
      refresh: false,
      optimistic: {
        queryKey: stateKey,
        apply: (prev) => !(prev ?? false),
      },
      onSuccess: (r) => {
        queryClient.setQueryData<boolean>(stateKey, r.bookmarked);
      },
      onError: (err) => {
        // 游客收藏 → 唤起登录引导（api 返回 401）
        if (isAuthError(err)) openLoginDialog();
      },
    },
  );

  return (
    <button
      type="button"
      onClick={() => {
        if (toggleMutation.pending) return;
        void toggleMutation.mutate(undefined);
      }}
      disabled={toggleMutation.pending}
      aria-pressed={bookmarked}
      title={bookmarked ? "取消收藏" : "收藏"}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600",
        "disabled:pointer-events-none disabled:opacity-60",
        bookmarked && "text-amber-600 hover:text-amber-600",
        className,
      )}
    >
      <Bookmark className={cn("size-4 shrink-0", bookmarked && "fill-current")} />
      {/* withLabel（详情操作栏）：恒显「收藏」两字保持宽度一致，激活态靠颜色区分 */}
      {withLabel && <span>收藏</span>}
    </button>
  );
}
