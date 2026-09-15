import { permanentRedirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { getPublishedPosts, toFeedItemDTO } from "@/components/user-space/queries";
import { resolveSingleUser, SingleUserHome } from "@/components/user-space/profile-view";
import { FeedStream } from "@/components/user-space/feed-stream";
import { TimelineHeader } from "@/components/site-shell";
import { PinnedComposer } from "@/components/social/pinned-composer";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * 首页 =「最新」时间线：发布框 + 全站混合动态流。
 * 「关注」拆分为独立页面 /following，左侧菜单直达；旧 ?tab=following 链接永久重定向。
 * 品牌横幅并入右栏「comit.sh 是什么」卡（site-rail）。单用户模式下首页仍是
 * 该用户的个人博客。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  // 旧版顶栏药丸链接（/?tab=following）→ 独立关注流页
  if (sp.tab === "following") permanentRedirect(routes.following);

  const [{ t, locale }, viewer, mode, { compose }] = await Promise.all([
    getT(),
    getCurrentUser(),
    getSetting("site.mode"),
    Promise.resolve(sp),
  ]);

  if (mode === "single") {
    const username = await getSetting("site.singleUser");
    const user = username ? await resolveSingleUser(username) : null;
    if (user) return <SingleUserHome user={user} viewer={viewer} />;
    // fall through to community home when the configured user is missing
  }

  const feed = await getPublishedPosts({ limit: 10 });
  return (
    <div className="min-h-dvh w-full pt-[10px]">
      <TimelineHeader title={locale === "zh" ? "最新" : "Latest"} paddingClass="px-5" />

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
        initialItems={feed.items.map(toFeedItemDTO)}
        initialCursor={feed.nextOffset}
        viewerUsername={viewer?.username}
      />
    </div>
  );
}
