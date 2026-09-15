"use client";

import { useEffect } from "react";

/**
 * 全局错误边界兜底 — 根 layout 自身渲染失败时的最后防线，
 * 必须自带 <html>/<body>。样式内联（globals.css 可能未加载）。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontFamily: "system-ui, sans-serif",
          background: "#f5f5f5",
          color: "#111",
        }}
      >
        <p style={{ fontSize: 14, fontWeight: 600 }}>应用出错了</p>
        <p style={{ fontSize: 12, color: "#666" }}>
          {error.digest ? `错误编号 ${error.digest}` : "发生了意外错误，请重试。"}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            borderRadius: 9999,
            background: "#111",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 16px",
            border: "none",
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </body>
    </html>
  );
}
