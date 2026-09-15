"use client";

import { requestJson } from "@/lib/client/api";

/** Admin 域客户端 — 传输统一委托 lib/client/api（!ok 抛带服务端 error 的异常）。 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(url, init
    ? {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      }
    : undefined);
}

/** Debounced state helper hook (used by search inputs). */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
