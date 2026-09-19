"use client";

import { useSyncExternalStore } from "react";
import {
  getProgressVersion,
  isProgressVisible,
  subscribeProgress,
} from "@/lib/client/progress";
import { cn } from "@/lib/utils";

/**
 * 顶部请求进度条 — 订阅 api.ts 收口点的在途请求计数：
 * 任意请求发起即出现（滑动动画循环），全部完成 350ms 后淡出隐藏。
 * SSR 渲染为不可见（getServerSnapshot false），水合后由客户端驱动。
 */
export function TopProgressBar() {
  useSyncExternalStore(subscribeProgress, isProgressVisible, () => false);
  const version = useSyncExternalStore(subscribeProgress, getProgressVersion, () => 0);
  void version;

  return (
    <div
      aria-hidden
      data-active={isProgressVisible()}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5 overflow-hidden transition-opacity duration-300",
        isProgressVisible() ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="progress-slide h-full w-1/3 rounded-full bg-primary" />
    </div>
  );
}
