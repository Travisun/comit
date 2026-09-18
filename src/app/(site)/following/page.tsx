import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { getPublishedPosts, toFeedItemDTO } from "@/components/user-space/queries";
import { FeedStream } from "@/components/user-space/feed-stream";
import { TimelineHeader } from "@/components/site-shell";
import { PinnedComposer } from "@/components/social/pinned-composer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: routes.following },
  title: "关注",
};

/**
 * 「关注」时间线（独立页面，左侧菜单直达）：只加载已关注作者的最新动态。
 * 未登录跳转登录页；无关注时由空态文案引导去发现页。
 */
export default async function FollowingPage() {
  const viewer = await getCurrentUser();
  if (!viewer) redirect(routes.login);

  const [{ locale }, feed] = await Promise.all([
    getT(),
    getPublishedPosts({ limit: 10, followingOf: viewer.id, viewerId: viewer.id }),
  ]);

  return (
    <div className="min-h-dvh w-full pt-[10px]">
      <TimelineHeader title={locale === "zh" ? "关注" : "Following"} paddingClass="px-5" />

      <PinnedComposer
        user={{
          displayName: viewer.displayName,
          username: viewer.username,
          avatarPath: viewer.avatarPath,
        }}
      />

      {feed.items.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
          还没有关注的人发布的动态。去<Link href={routes.explore} className="text-link hover:underline">发现页</Link>找到感兴趣的人吧。
        </div>
      ) : (
        <FeedStream
          initialItems={feed.items.map(toFeedItemDTO)}
          initialCursor={feed.nextOffset}
          viewerUsername={viewer.username}
          scope="following"
        />
      )}
    </div>
  );
}
