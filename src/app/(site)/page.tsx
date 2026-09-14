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
import { cn } from "@/lib/utils";
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
  searchParams: Promise<{ compose?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const [{ t }, viewer, mode, { compose }] = await Promise.all([
    getT(),
    getCurrentUser(),
    getSetting("site.mode"),
    Promise.resolve(sp),
  ]);
  const tab = sp.tab === "following" && viewer ? "following" : "latest";

  if (mode === "single") {
    const username = await getSetting("site.singleUser");
    const user = username ? await resolveSingleUser(username) : null;
    if (user) return <SingleUserHome user={user} viewer={viewer} />;
    // fall through to community home when the configured user is missing
  }

  const feed =
    tab === "following" && viewer
      ? await getPublishedPosts({ limit: 10, followingOf: viewer.id })
      : await getPublishedPosts({ limit: 10 });
  const { items, nextOffset } = feed;

  return (
    <div className="min-h-dvh w-full max-w-[600px] pt-[10px]">
      <TimelineHeader
        title="社区"
        className="border-b border-border"
        right={
          <nav aria-label="时间线" className="flex items-center gap-1">
            <Link
              href="/"
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-colors",
                tab !== "following"
                  ? "bg-[var(--selected)] font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              最新
            </Link>
            <Link
              href="/?tab=following"
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-colors",
                tab === "following"
                  ? "bg-[var(--selected)] font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              关注
            </Link>
          </nav>
        }
      />

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

      {tab === "following" && feed.items.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
          还没有关注的人发布的动态。去发现页找到感兴趣的人吧。
        </div>
      ) : (
        <FeedStream
          initialItems={feed.items.map(toFeedItemDTO)}
          initialCursor={feed.nextOffset}
          viewerUsername={viewer?.username}
          scope={tab === "following" ? "following" : undefined}
        />
      )}
    </div>
  );
}
