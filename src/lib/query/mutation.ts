"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/client/api";
import { useRscRefresh } from "@/lib/client/rsc-refresh";

/**
 * 提交类操作的统一封装（基于 TanStack useMutation）：
 * pending 状态 + 失败 toast（可关）+ 成功后自动 `router.refresh()`
 * （服务端组件数据回流的默认手段，`refresh: false` 关掉，改用
 * `queryClient.setQueryData / invalidateQueries` 做细粒度更新）。
 *
 * ```tsx
 * const { mutate, pending } = useApiMutation(
 *   (postId: string) => postJson("/api/bookmarks", { postId }),
 *   { successToast: "已收藏" },
 * );
 * ```
 *
 * 乐观更新：传 `optimistic` 在请求发出前改缓存，失败时自动回滚到
 * `onMutate` 返回的快照（等价于 useMutation 的 onMutate/onError 链）。
 *
 * ```tsx
 * useApiMutation(toggleLike, {
 *   refresh: false,
 *   optimistic: {
 *     queryKey: queryKeys.postRelations(postId),
 *     apply: (prev) => ({ ...prev, liked: !prev.liked }),
 *   },
 * });
 * ```
 */
export function useApiMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  opts?: {
    /** 成功后的 router.refresh()，默认 true */
    refresh?: boolean;
    /** 成功后要失效的查询键（触发对应 useQuery 重查，键来自 queryKeys） */
    invalidate?: readonly (readonly unknown[])[];
    successToast?: string | ((data: TOutput) => string);
    /** 抑制默认的错误 toast（调用方自行处理，如 422 审核分支） */
    silent?: boolean;
    /**
     * 乐观更新：`apply(prev, input)` 返回新缓存值；请求失败时该键自动
     * 回滚到 apply 前的快照，成功后的 invalidate/refresh 照常执行。
     */
    optimistic?: {
      queryKey: readonly unknown[];
      apply: (prev: unknown, input: TInput) => unknown;
    };
    onSuccess?: (data: TOutput, input: TInput) => void;
    onError?: (err: ApiError | Error) => void;
  },
): { mutate: (input: TInput) => Promise<TOutput | undefined>; pending: boolean } {
  const { refresh = true, invalidate, successToast, silent, optimistic, onSuccess, onError } =
    opts ?? {};
  const scheduleRefresh = useRscRefresh();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: fn,
    onMutate: optimistic
      ? async (input: TInput) => {
          const key = optimistic.queryKey;
          const snapshot = queryClient.getQueryData(key);
          const next = optimistic.apply(snapshot, input);
          queryClient.setQueryData(key, next);
          return { key, snapshot };
        }
      : undefined,
    onError: (err, _input, context) => {
      // 乐观更新失败：回滚到 onMutate 时的快照
      if (context && typeof context === "object" && "key" in context) {
        const { key, snapshot } = context as { key: readonly unknown[]; snapshot: unknown };
        queryClient.setQueryData(key, snapshot);
      }
      const e = err instanceof ApiError ? err : err instanceof Error ? err : new Error(String(err));
      if (!silent) toast.error(e.message);
      onError?.(e);
    },
    onSuccess: (data, input) => {
      if (successToast) {
        toast.success(typeof successToast === "function" ? successToast(data) : successToast);
      }
      for (const key of invalidate ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // 统一走合并刷新通道:同一窗口内多个 mutation 收尾折叠为一次
      // 重验,任一时刻至多一条重验 RSC 流(生命周期约束见 rsc-refresh.ts)
      if (refresh) scheduleRefresh();
      onSuccess?.(data, input);
    },
  });

  /** 与历史契约一致：失败不抛出，返回 undefined 由调用方判空 */
  const mutate = useCallback(
    async (input: TInput) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return undefined;
      }
    },
    [mutation],
  );

  return { mutate, pending: mutation.isPending };
}

export { useQueryClient };
