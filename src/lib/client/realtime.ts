"use client";

import { useEffect, useRef } from "react";

/**
 * 实时事件订阅（SSE）— 模块级单例总线。
 *
 * 所有 useRealtime 订阅共享同一条 EventSource 连接：首个订阅者出现时建立，
 * 最后一个取消时关闭；事件经内部 Set<listener> 分发给全部订阅方，避免每处
 * useRealtime 各开一条连接（HTTP/1.1 下浏览器同源连接数很容易被耗尽）。
 *
 * ```ts
 * useRealtime((event) => {
 *   if (event.type === "unread.changed") queryClient.invalidateQueries(...);
 * });
 * ```
 */

type RealtimeEvent = { type: string; payload?: unknown; ts: number };

const listeners = new Set<(event: RealtimeEvent) => void>();
let source: EventSource | null = null;

function dispatch(event: RealtimeEvent): void {
  for (const listener of listeners) listener(event);
}

function ensureSource(): void {
  if (source) return;
  const es = new EventSource("/api/realtime/stream");
  source = es;
  es.onopen = () => {
    // 首次建立与断线重连成功都会触发 onopen：派发合成事件，订阅方可借此
    // 失效查询（invalidate），补偿断线窗口内丢失的推送事件。
    dispatch({ type: "realtime.reconnected", ts: Date.now() });
  };
  es.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as RealtimeEvent;
      if (parsed.type !== "ping" && parsed.type !== "hello") dispatch(parsed);
    } catch {
      /* 忽略畸形帧 */
    }
  };
  // onerror 不做处理：EventSource 由浏览器原生自动重连，重连成功会再次
  // 触发 onopen（见上），这里无需手动重建连接。
}

function teardown(): void {
  source?.close();
  source = null;
}

export function useRealtime(
  onEvent: (event: RealtimeEvent) => void,
  enabled = true,
): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: RealtimeEvent) => handler.current(event);
    listeners.add(listener);
    ensureSource();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) teardown();
    };
  }, [enabled]);
}
