"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 本地未读标识（纯浏览器侧，不落服务端）：
 *  - localStorage 记录每个入口「上次看过的新内容时间」（unread-seen:<key>）；
 *  - 时间戳作为参数发给单一接口 /api/unread，一次请求拿回三个计数；
 *  - 用户进入对应页面时把 seen 推进到「现在」，该处未读清零。
 * key → 数据源：latest=全站动态流、following=关注流、messages=会话+通知。
 */

const SEEN_PREFIX = "unread-seen:";
const POLL_MS = 60_000;

export type LocalUnread = { latest: number; following: number; messages: number };

/** 页面路径 → 未读 key（进入该页即视为已读） */
function keyForPath(pathname: string): string | null {
  if (pathname === "/") return "latest";
  if (pathname.startsWith("/following")) return "following";
  if (pathname.startsWith("/messages")) return "messages";
  return null;
}

function getSeen(key: string): number {
  const raw = localStorage.getItem(SEEN_PREFIX + key);
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function markSeen(key: string) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, new Date().toISOString());
  } catch {
    /* storage 不可用时静默 */
  }
}

export function useLocalUnread(user: { username: string } | null | undefined): LocalUnread {
  const pathname = usePathname();
  const [unread, setUnread] = useState<LocalUnread>({ latest: 0, following: 0, messages: 0 });

  useEffect(() => {
    // 进入对应页面的瞬间：推进 seen 标记（该入口清零）
    const seenKey = keyForPath(pathname);
    if (seenKey) markSeen(seenKey);

    let cancelled = false;

    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // 单一接口：seen 时间戳作为参数，服务端一次性返回三个计数
      const qs = new URLSearchParams({
        latest: String(getSeen("latest")),
        following: String(getSeen("following")),
        messages: String(getSeen("messages")),
      });
      try {
        const res = await fetch(`/api/unread?${qs.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LocalUnread;
        if (!cancelled) setUnread(data);
      } catch {
        /* silent — 轮询失败不打扰 */
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname, user]);

  // 当前所在页面的未读数永远显示为 0
  const seenKey = keyForPath(pathname);
  return {
    latest: seenKey === "latest" ? 0 : unread.latest,
    following: seenKey === "following" ? 0 : unread.following,
    messages: seenKey === "messages" ? 0 : unread.messages,
  };
}
