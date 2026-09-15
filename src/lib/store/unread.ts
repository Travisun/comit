"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * 本地未读 seen 标记（纯浏览器侧状态，不落服务端）—— Zustand persist
 * 管理 localStorage 持久化。计数本体（server state）由 use-local-unread
 * 里的 useQuery 轮询获取；本 store 只存「每个入口上次浏览时间」。
 *
 * key → 数据源：latest=全站动态流、following=关注流、messages=会话+通知。
 */

export type UnreadSeenKey = "latest" | "following" | "messages";

interface UnreadSeenState {
  seen: Record<UnreadSeenKey, number>;
  markSeen: (key: UnreadSeenKey, at?: number) => void;
}

export const useUnreadSeenStore = create<UnreadSeenState>()(
  persist(
    (set) => ({
      seen: { latest: 0, following: 0, messages: 0 },
      markSeen: (key, at = Date.now()) =>
        set((s) => ({ seen: { ...s.seen, [key]: at } })),
    }),
    {
      name: "unread-seen.v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ seen: s.seen }),
    },
  ),
);
