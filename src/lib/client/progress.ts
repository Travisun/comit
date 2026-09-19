/**
 * 全局 API 请求进度跟踪（单例 store）。
 *
 * api.ts 的 request() 收口点在请求开始/结束时调用 startProgress/endProgress；
 * TopProgressBar 组件经 useSyncExternalStore 订阅可见性，渲染顶部进度条。
 * 设计要点：
 *  - 计数归零后延迟 350ms 再隐藏：避免瞬时请求导致的闪烁，也让进度动画
 *    有机会完成收尾；
 *  - 快照返回 version（单调递增），组件侧据此判断可见性变化。
 */

let inflight = 0;
let visible = false;
let version = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export function startProgress(): void {
  inflight += 1;
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!visible) {
    visible = true;
    emit();
  }
}

export function endProgress(): void {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0 && visible && hideTimer === null) {
    // 收尾缓冲：进度条完整走完一次收尾动画再隐藏
    hideTimer = setTimeout(() => {
      hideTimer = null;
      visible = false;
      emit();
    }, 350);
  }
}

export function subscribeProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProgressVersion(): number {
  return version;
}

export function isProgressVisible(): boolean {
  return visible;
}
