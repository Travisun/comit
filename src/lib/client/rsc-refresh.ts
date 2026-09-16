"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

/**
 * RSC 重验生命周期原语 — 全应用唯一的 router.refresh 通道。
 *
 * 数据流生命周期约束（架构规则,非补丁）:任一时刻至多存在一条重验 RSC 流。
 *  - 合并:同一窗口内的多次 refresh 请求（多个 mutation 连发、多组件同时
 *    收尾）折叠为一次;
 *  - 尾随:重验进行中到达的新请求不丢弃,在窗口结束后补一次,保证最终
 *    状态一致;
 *  - 可中断:实际刷新始终包在 startTransition 里,不阻塞交互、可被导航
 *    打断。
 * 这消除了「多条 RSC 流并发交叠」这一 flight 客户端竞态
 * （enqueueModel 崩溃）的应用侧触发面。
 */

const SETTLE_MS = 400;

let refreshFn: (() => void) | null = null;
let running = false;
let trailing = false;

/** 由 useRscRefresh 在挂载时绑定,应用内不要直接调用。 */
export function bindRscRefresh(fn: () => void): void {
  refreshFn = fn;
}

function run(): void {
  running = true;
  const fn = refreshFn;
  startTransition(() => fn?.());
  // router.refresh 派发后即返回,流在后台进行;以短窗口近似"在途",
  // 窗口内的新请求折叠为尾随补验
  setTimeout(() => {
    running = false;
    if (trailing) {
      trailing = false;
      run();
    }
  }, SETTLE_MS);
}

export function scheduleRscRefresh(): void {
  if (!refreshFn) return;
  if (running) {
    trailing = true;
    return;
  }
  run();
}

/** 消费端 hook:绑定 router 并返回合并后的刷新函数（全应用统一走它）。 */
export function useRscRefresh(): () => void {
  const router = useRouter();
  useEffect(() => {
    bindRscRefresh(() => router.refresh());
  }, [router]);
  return scheduleRscRefresh;
}
