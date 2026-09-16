"use client";

import { toast } from "sonner";

/**
 * Toast 消息标准化 — 全站统一的 sonner 封装（时长/样式/错误透传一处管理）。
 * 组件代码不再直接 import sonner 的裸 toast；扩展同样使用这里的能力。
 *
 *  - appToast.success / error / info：统一时长与文案基准；
 *  - appToast.fromError(err, fallback)：ApiError 的服务端 message 直接透传，
 *    非 Error 对象回退到 fallback 文案。
 */

const DURATION = { success: 2600, error: 4200, info: 3000 } as const;

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export const appToast = {
  success(message: string) {
    toast.success(message, { duration: DURATION.success });
  },
  error(message: string, opts?: { err?: unknown; fallback?: string }) {
    toast.error(
      opts?.err !== undefined ? messageOf(opts.err, opts.fallback ?? message) : message,
      { duration: DURATION.error },
    );
  },
  info(message: string) {
    toast.info(message, { duration: DURATION.info });
  },
  /** 提交失败的标准出口：toast.error("保存失败", { err }) */
  fromError(err: unknown, fallback = "操作失败，请重试") {
    toast.error(messageOf(err, fallback), { duration: DURATION.error });
  },
};
