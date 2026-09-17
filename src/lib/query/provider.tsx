"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/client/api";

/**
 * TanStack Query 接入点 — 服务端状态（server state）的唯一管理方。
 * 挂载于根 layout，全站共享一个 QueryClient。
 *
 * 默认策略与站点行为对齐：API 均为 force-dynamic、无缓存头，因此
 * staleTime 15s（路由来回切换免闪 loading）、不打窗口聚焦重拉、
 * 失败重试 1 次（上传/发布类调用自行在 mutation 层处理）。
 *
 * retry 必须是函数而非数值：数值型 retry 对 4xx 一律盲目重试 —— 每个
 * 404/403/422 都会打两遍（schema 校验失败的确定性错误还会真的重新
 * fetch 一次 URL），401 还会触发两次登录重定向。只重试 5xx/网络/超时。
 */
function shouldRetry(failureCount: number, err: unknown): boolean {
  if (failureCount >= 1) return false;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 0;
  return true;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            retry: shouldRetry,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
