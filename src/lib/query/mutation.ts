"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/client/api";

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
    onSuccess?: (data: TOutput, input: TInput) => void;
    onError?: (err: ApiError | Error) => void;
  },
): { mutate: (input: TInput) => Promise<TOutput | undefined>; pending: boolean } {
  const { refresh = true, invalidate, successToast, silent, onSuccess, onError } = opts ?? {};
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: (data, input) => {
      if (successToast) {
        toast.success(typeof successToast === "function" ? successToast(data) : successToast);
      }
      for (const key of invalidate ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (refresh) router.refresh();
      onSuccess?.(data, input);
    },
    onError: (err) => {
      const e = err instanceof ApiError ? err : err instanceof Error ? err : new Error(String(err));
      if (!silent) toast.error(e.message);
      onError?.(e);
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
