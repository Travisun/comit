"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { requestJson } from "@/components/social/api";

/**
 * 本地未读标识（纯浏览器侧，不落服务端）：
 *  - localStorage 记录每个入口「上次看过的新内容时间」（unread-seen:<key>）；
 *  - 每 60s 轮询一次对应数据源，比 seen 时间戳新的条目数即未读数；
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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    return await requestJson<T>(url);
  } catch {
    return null;
  }
}

interface FeedResp {
  items: { post: { publishedAt: string | null } }[];
}
interface ConvResp {
  conversations?: { lastMessageAt?: string | null }[];
}
interface NotifResp {
  items?: { createdAt: string }[];
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

      // 最新流（匿名也可读）
      const feed = await fetchJson<FeedResp>("/api/feed?limit=20");
      if (cancelled || !feed) return;
      const latestSeen = getSeen("latest");
      const latest = feed.items.filter(
        (i) => i.post.publishedAt && Date.parse(i.post.publishedAt) > latestSeen,
      ).length;

      // 关注流与消息仅登录用户
      let following = 0;
      let messages = 0;
      if (user) {
        const f = await fetchJson<FeedResp>("/api/feed?scope=following&limit=20");
        if (cancelled) return;
        const followingSeen = getSeen("following");
        following = (f?.items ?? []).filter(
          (i) => i.post.publishedAt && Date.parse(i.post.publishedAt) > followingSeen,
        ).length;

        const convs = await fetchJson<ConvResp>("/api/messages/conversations");
        if (cancelled) return;
        const notifs = await fetchJson<NotifResp>("/api/notifications?limit=1");
        if (cancelled) return;
        const msgSeen = getSeen("messages");
        const newConvs = (convs?.conversations ?? []).filter(
          (x) => x.lastMessageAt && Date.parse(x.lastMessageAt) > msgSeen,
        ).length;
        const newNotifs = (notifs?.items ?? []).filter(
          (x) => Date.parse(x.createdAt) > msgSeen,
        ).length;
        messages = newConvs + newNotifs;
      }

      if (!cancelled) setUnread({ latest, following, messages });
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
