"use client";

import { queryOptions } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { apiGet } from "@/lib/client/api";
import { ApiError } from "@/lib/client/api";

/**
 * 带运行时校验的查询选项工厂 — 数据流的模型防线：
 * 每次响应在进入缓存前经 `schema.parse` 校验，服务端字段漂移
 * （改名/缺字段/类型变化）在边界抛出带 URL 上下文的错误，
 * 而不是把坏数据放进组件渲染时才崩。
 *
 * ```tsx
 * const { data } = useQuery(apiQueryOptions({
 *   queryKey: queryKeys.poll(postId),
 *   url: `/api/posts/${postId}/poll`,
 *   schema: pollViewSchema,
 * }));
 * ```
 */
export function apiQueryOptions<T>({
  queryKey,
  url,
  schema,
  ...opts
}: {
  queryKey: readonly unknown[];
  url: string;
  schema: ZodType<T>;
} & Omit<Parameters<typeof queryOptions<T>>[0], "queryKey" | "queryFn">) {
  return queryOptions<T>({
    queryKey,
    queryFn: async () => {
      const raw = await apiGet<unknown>(url);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new ApiError(422, {
          error: `响应数据模型不匹配 (${url})：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
        });
      }
      return parsed.data;
    },
    ...opts,
  });
}
