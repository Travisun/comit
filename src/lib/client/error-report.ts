"use client";

/**
 * 客户端错误上报 — 扩展边界 / 错误边界统一报告通道。
 *  - console.error 保留（dev 终端经 Next 转发可见）;
 *  - fire-and-forget POST /api/client-errors（服务端 logger 落日志,
 *    可与 digest/请求日志关联）;
 *  - 限流:单页会话至多 20 条/分钟,防错误风暴打爆网络。
 */

let windowStart = 0;
let windowCount = 0;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

export function reportClientError(
  scope: string,
  error: unknown,
  extra?: { componentStack?: string | null },
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${scope}]`, error);

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_PER_WINDOW) return;

  try {
    void fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        message,
        stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        componentStack: extra?.componentStack?.slice(0, 2000),
        path: typeof location !== "undefined" ? location.pathname : undefined,
        ts: now,
      }),
    }).catch(() => undefined);
  } catch {
    /* 上报通道自身失败必须零影响 */
  }
}
