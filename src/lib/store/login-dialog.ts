import { create } from "zustand";

/**
 * 全局登录引导 Dialog 开关 — 游客在任何交互点（发布/评论/关注/私信入口）
 * 都唤起同一个登录引导弹窗，替代散落的页面跳转。
 * Zustand 模块级单例（与 unread store 同款模式）。
 */
interface LoginDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useLoginDialogStore = create<LoginDialogState>()((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));

/** 命令式唤起（非组件上下文也能用）。 */
export function openLoginDialog(): void {
  useLoginDialogStore.getState().openDialog();
}
