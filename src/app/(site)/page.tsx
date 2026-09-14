import Link from "next/link";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import {
  getActiveAuthors,
  getCommunityStats,
  getHotPosts,
  getPublishedPosts,
  toFeedItemDTO,
} from "@/components/user-space/queries";
import { resolveSingleUser, SingleUserHome } from "@/components/user-space/profile-view";
import { FeedStream } from "@/components/user-space/feed-stream";
import { TimelineHeader, UnderlineTabs } from "@/components/site-shell";
import { PinnedComposer } from "@/components/social/pinned-composer";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * 官方主页 = X 式时间线：页签条（最新/关注）+ 发布框 + 全站混合动态流。
 * 品牌横幅并入右栏「comit.sh 是什么」卡（site-rail）。单用户模式下首页仍是
 * 该用户的个人博客。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string }>;
}) {
  const [{ t }, viewer, mode, { compose }] = await Promise.all([
    getT(),
    getCurrentUser(),
    getSetting("site.mode"),
    searchParams,
  ]);

  if (mode === "single") {
    const username = await getSetting("site.singleUser");
    const user = username ? await resolveSingleUser(username) : null;
    if (user) return <SingleUserHome user={user} viewer={viewer} />;
    // fall through to community home when the configured user is missing
  }

  // 数据获取保持不变（混合流 + 社区数据 + 热门/话题/活跃作者——后三者由右栏 SiteRail 消费）
  const [{ items, nextOffset }] = await Promise.all([
    getPublishedPosts({ limit: 10 }),
    getCommunityStats(),
    getHotPosts(5),
    getActiveAuthors(5),
  ]);

  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      <TimelineHeader title="社区">
        <UnderlineTabs
          tabs={[
            { key: "latest", label: "最新", active: true },
            { key: "following", label: "关注", disabled: true },
          ]}
        />
      </TimelineHeader>

      {viewer ? (
        <PinnedComposer
          initialExpanded={compose === "1"}
          user={{
            displayName: viewer.displayName,
            username: viewer.username,
            avatarPath: viewer.avatarPath,
          }}
        />
      ) : (
        <div className="border-b border-border px-4 py-4">
          <p className="text-[15px] leading-snug">
            <span className="font-bold">{t("home.hero.title")}</span>
            <span className="text-muted-foreground"> · {t("app.slogan")}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-full">
              <Link href={routes.register}>{t("nav.register")}</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href={routes.login}>{t("nav.login")}</Link>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">登录后加入讨论，发布你的第一条动态。</p>
        </div>
      )}

      <FeedStream
        initialItems={items.map(toFeedItemDTO)}
        initialCursor={nextOffset}
        viewerUsername={viewer?.username}
      />
    </div>
  );
}
