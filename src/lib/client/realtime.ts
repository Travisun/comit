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
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/** 被服务端挤占后的重连冷却截止时间（防立即重连再被挤占的风暴） */
let evictedCooldownUntil = 0;

function dispatch(event: RealtimeEvent): void {
  for (const listener of listeners) listener(event);
}

function ensureSource(): void {
  // 页面切换瞬间订阅者可能短暂归零又恢复（旧页卸载 → 新页挂载），
  // 若有未到期的延迟释放，取消之，连接继续复用。
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (source) return;
  // 被挤占冷却期内不建连：服务端每账号有连接数上限，超额时挤占最旧连接。
  // 立即重连只会立刻再被挤占（形成两标签页互踢的风暴）；冷却过后、或下次
  // 页面导航重新挂载订阅时自然恢复。冷却期内事件丢失由 resync/reconnected
  // 补偿机制兜底。
  if (Date.now() < evictedCooldownUntil) return;
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
      if (parsed.type === "ping" || parsed.type === "hello") return;
      if (parsed.type === "realtime.evicted") {
        // 服务端连接数上限挤占：安静关闭，进入冷却（见 ensureSource）。
        // 与 e.close() 不同，这里要让单例彻底复位。
        evictedCooldownUntil = Date.now() + 60_000;
        es.close();
        source = null;
        return;
      }
      // 服务端 pg LISTEN 断线重连成功后的全量补偿信号 —— 语义与
      // realtime.reconnected 一致（订阅方据此 invalidate 补丢），归一处理，
      // 三处消费点无需各自感知两种事件名。
      if (parsed.type === "realtime.resync") parsed.type = "realtime.reconnected";
      dispatch(parsed);
    } catch {
      /* 忽略畸形帧 */
    }
  };
  // onerror 不做处理：EventSource 由浏览器原生自动重连（服务端已下发
  // retry: 30s 退避）。会话失效时服务端返回 204，浏览器按规范永久停止重连。
}

function scheduleRelease(): void {
  if (releaseTimer !== null) return;
  // 去抖 5s 再真正断连：避免每次路由切换（订阅者瞬时归零）都拆掉再重建
  // SSE 连接 —— 连接churn 会放大服务端 sse.closed 噪音、加重重连风暴，
  // 断线窗口内到达的事件还得靠 reconnected 补偿路径兜底。
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  }, 5_000);
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
      if (listeners.size === 0) scheduleRelease();
    };
  }, [enabled]);
}
