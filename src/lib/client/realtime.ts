"use client";

import { useEffect, useRef } from "react";

/**
 * 实时事件订阅（SSE）— 断线自动重连（EventSource 原生行为）。
 *
 * ```ts
 * useRealtime((event) => {
 *   if (event.type === "unread.changed") queryClient.invalidateQueries(...);
 * });
 * ```
 */
export function useRealtime(
  onEvent: (event: { type: string; payload?: unknown; ts: number }) => void,
  enabled = true,
): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/realtime/stream");
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { type: string; payload?: unknown; ts: number };
        if (parsed.type !== "ping" && parsed.type !== "hello") handler.current(parsed);
      } catch {
        /* 忽略畸形帧 */
      }
    };
    return () => es.close();
  }, [enabled]);
}
