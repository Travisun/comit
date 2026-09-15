"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import { unreadSchema, type UnreadCounts } from "@/lib/models/unread";
import { queryKeys } from "@/lib/query/keys";
import { useUnreadSeenStore, type UnreadSeenKey } from "@/lib/store/unread";

/**
 * 本地未读标识：
 *  - 「上次看过的新内容时间」存在 Zustand persist store（src/lib/store/unread.ts）；
 *  - 计数本体经 useQuery 轮询 /api/unread（seen 时间戳作为参数，一次请求
 *    拿回三个计数）；seen 变化 ⇒ queryKey 变化 ⇒ 自动重查；
 *  - 用户进入对应页面时把 seen 推进到「现在」，该处未读清零。
 */

export type LocalUnread = UnreadCounts;

const POLL_MS = 60_000;

/** 页面路径 → 未读 key（进入该页即视为已读） */
function keyForPath(pathname: string): UnreadSeenKey | null {
  if (pathname === "/") return "latest";
  if (pathname.startsWith("/following")) return "following";
  if (pathname.startsWith("/messages")) return "messages";
  return null;
}

export function useLocalUnread(user: { username: string } | null | undefined): LocalUnread {
  const pathname = usePathname();
  const seen = useUnreadSeenStore((s) => s.seen);
  const markSeen = useUnreadSeenStore((s) => s.markSeen);

  // 进入对应页面的瞬间：推进 seen 标记（该入口清零）——键变化驱动重查
  useEffect(() => {
    const seenKey = keyForPath(pathname);
    if (seenKey) markSeen(seenKey);
  }, [pathname, markSeen, user]);

  const { data } = useQuery({
    ...unreadQueryOptions(seen),
    refetchInterval: POLL_MS,
    // 后台标签页不轮询（对应旧的 visibilityState 检查）
    refetchIntervalInBackground: false,
    staleTime: 45_000,
  });

  // 当前所在页面的未读数永远显示为 0
  const seenKey = keyForPath(pathname);
  return {
    latest: seenKey === "latest" ? 0 : (data?.latest ?? 0),
    following: seenKey === "following" ? 0 : (data?.following ?? 0),
    messages: seenKey === "messages" ? 0 : (data?.messages ?? 0),
  };
}

function unreadQueryOptions(seen: Record<UnreadSeenKey, number>) {
  const qs = new URLSearchParams({
    latest: String(seen.latest),
    following: String(seen.following),
    messages: String(seen.messages),
  });
  return {
    queryKey: queryKeys.unread(seen),
    queryFn: async () => {
      const raw = await apiGet<unknown>(`/api/unread?${qs.toString()}`);
      return unreadSchema.parse(raw);
    },
  };
}
