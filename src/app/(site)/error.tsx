"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/error-report";

/**
 * (site) 路由段错误边界 — 前台页面渲染期/数据异常不白屏。
 * 风格复用根 error.tsx（居中卡片 + 重试按钮），并接入统一上报通道
 * （reportClientError 内部保留 console.error，dev 终端行为不变）。
 * error.digest 可用于关联服务端日志。
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("site-error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-foreground">页面出错了</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {error.digest ? `错误编号 ${error.digest}` : "发生了意外错误，请重试。"}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        重试
      </button>
    </div>
  );
}
