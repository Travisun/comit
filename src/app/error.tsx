"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/error-report";

/**
 * 路由段错误边界兜底 — 渲染期/数据异常不白屏，给出可重试卡片。
 * 上报走统一通道 reportClientError（fire-and-forget POST /api/client-errors，
 * 内部保留 console.error("[app-error]", error) 的原有终端行为）。
 * error.digest 可用于关联服务端日志。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("app-error", error);
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
