"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * TanStack Query 接入点 — 服务端状态（server state）的唯一管理方。
 * 挂载于根 layout，全站共享一个 QueryClient。
 *
 * 默认策略与站点行为对齐：API 均为 force-dynamic、无缓存头，因此
 * staleTime 15s（路由来回切换免闪 loading）、不打窗口聚焦重拉、
 * 失败重试 1 次（上传/发布类调用自行在 mutation 层处理）。
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
