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
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ seen: s.seen }),
      // v1 迁移：旧键 unread-seen:{latest|following|messages}（扁平三键）→
      // 写入新结构并清除，消除升级后未读数一次性虚高
      migrate: (state) => {
        try {
          const legacy: Partial<Record<"latest" | "following" | "messages", number>> = {};
          for (const k of ["latest", "following", "messages"] as const) {
            const raw = localStorage.getItem(`unread-seen:${k}`);
            if (raw) {
              const n = Number(raw);
              if (Number.isFinite(n)) legacy[k] = n;
              localStorage.removeItem(`unread-seen:${k}`);
            }
          }
          const merged = { latest: 0, following: 0, messages: 0, ...(state as { seen?: object })?.seen, ...legacy };
          return { seen: merged };
        } catch {
          return state as { seen: Record<string, number> };
        }
      },
    },
  ),
);
