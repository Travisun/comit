import Link from "next/link";
import { FileText, Hash, LogIn, Rss, Trash2 } from "lucide-react";
import { routes } from "@/core/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import type { AuthorCardData, TopicRef } from "@/components/user-space/types";
import type { CommunityStats } from "@/components/user-space/queries";

/**
 * Global right rail for the X-style shell (rendered by the site layout),
 * built around the viewing user's perspective: search → [logged-in: "我的博客"
 * console card (own stats + management links) | logged-out: sign-in CTA] →
 * about → trending topics → active authors. Flat bordered cards, no shadows.
 */
export function SiteRail({
  siteName,
  topics,
  authors,
  stats,
  user,
  myStats,
}: {
  siteName: string;
  topics: TopicRef[];
  authors: AuthorCardData[];
  stats: CommunityStats | null;
  /** logged-in viewer — shows the personal blog console instead of the CTA */
  user?: {
    displayName: string;
    username: string;
    avatarPath: string | null;
  } | null;
  /** viewer's own published/follow counts (best-effort) */
  myStats?: { posts: number; followers: number; following: number } | null;
}) {
  return (
    <div className="space-y-3">
      {/* search — GET /explore?q= */}
      <form action={routes.explore} role="search" className="sticky top-0 z-10 -mx-5 bg-card/80 px-5 pt-[15px] pb-3 backdrop-blur-md">
        <label className="flex items-center gap-2 rounded-full border border-border px-3.5 py-2 transition-colors focus-within:border-primary/50 focus-within:bg-card">
          <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            placeholder="搜索 comit.sh"
            aria-label="搜索"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </form>

      {/* 我的博客 console (logged-in) / sign-in CTA (logged-out) */}
      {user ? (
        <section className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              {user.avatarPath && (
                <AvatarImage src={`/api/media/file/${user.avatarPath}`} alt={user.displayName} />
              )}
              <AvatarFallback className="text-base">
                {user.displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold">{user.displayName}</p>
              <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
            </div>
          </div>
          {myStats && (
            <Link
              href={routes.profile(user.username)}
              className="num mt-2.5 block rounded-md bg-[var(--muted)] px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-[var(--hover)]"
            >
              {myStats.posts} 篇内容 · {myStats.followers} 粉丝 · {myStats.following} 关注
            </Link>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Link
              href="/write/posts"
              className="flex items-center justify-center gap-1.5 rounded-full bg-primary py-1.5 text-center text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <FileText className="size-3.5" aria-hidden />
              文章管理
            </Link>
            <Link
              href="/write/posts?tab=trash"
              className="flex items-center justify-center gap-1.5 rounded-full border border-border py-1.5 text-center text-[13px] font-medium transition-colors hover:bg-[var(--hover)]"
            >
              <Trash2 className="size-3.5" aria-hidden />
              回收站
            </Link>
            <Link
              href={routes.profile(user.username)}
              className="col-span-2 block rounded-full border border-border py-1 text-center text-[13px] font-medium transition-colors hover:bg-[var(--hover)]"
            >
              我的主页
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border p-3">
          <h2 className="text-sm font-bold">新到 {siteName}</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            创建账号，记录你的科研日志与技术文章，并关注你感兴趣的作者。
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href="/auth/register"
              className="rounded-full bg-primary py-1.5 text-center text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              创建账号
            </Link>
            <Link
              href="/auth/login"
              className="flex items-center justify-center gap-1.5 rounded-full border border-border py-1.5 text-center text-[13px] font-medium transition-colors hover:bg-[var(--hover)]"
            >
              <LogIn className="size-3.5" />
              登录
            </Link>
          </div>
        </section>
      )}

      {/* what is comit.sh */}
      <section className="rounded-lg border border-border p-3">
        <h2 className="text-sm font-bold">{siteName} 是什么</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          极客 · 设计师 · 科学家 · CS 学子的个人品牌社区 —— 记录科研日志、技术学习、研究发布与项目动态。
        </p>
        {stats && (
          <p className="num mt-1.5 text-xs text-muted-foreground">
            {stats.members} 位成员 · {stats.posts} 篇公开内容 · 今日 {stats.today} 条动态
          </p>
        )}
        <Link
          href="/about"
          className="mt-2 inline-block text-[13px] font-medium text-primary hover:underline"
        >
          了解更多 →
        </Link>
      </section>

      {/* trending topics */}
      {topics.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border">
          <h2 className="px-4 pb-1 pt-3 text-[15px] font-bold">话题正在发生</h2>
          <ul>
            {topics.slice(0, 5).map((tp) => (
              <li key={tp.slug}>
                <Link
                  href={routes.topic(tp.slug)}
                  className="block px-4 py-2.5 transition-colors hover:bg-[var(--hover,#f7f8f8)]"
                >
                  <span className="block truncate text-sm font-semibold">#{tp.name}</span>
                  <span className="num block text-xs text-muted-foreground">
                    {tp.postCount ?? 0} 条内容
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={routes.explore}
            className="block px-4 py-3 text-sm text-primary transition-colors hover:bg-[var(--hover,#f7f8f8)]"
          >
            查看全部 →
          </Link>
        </section>
      )}

      {/* active authors */}
      {authors.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border">
          <h2 className="px-4 pb-1 pt-3 text-[15px] font-bold">活跃作者</h2>
          <ul>
            {authors.map((a) => (
              <li key={a.username}>
                <Link
                  href={routes.profile(a.username)}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--hover,#f7f8f8)]"
                >
                  <Avatar className="size-10">
                    {a.avatarPath && (
                      <AvatarImage src={routes.media(a.avatarPath)} alt={a.displayName} />
                    )}
                    <AvatarFallback>{a.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{a.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{a.username}
                    </span>
                  </span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {a.followerCount} 关注
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={routes.explore}
            className="block px-4 py-3 text-sm text-primary transition-colors hover:bg-[var(--hover,#f7f8f8)]"
          >
            查看全部 →
          </Link>
        </section>
      )}

      {/* footer links */}
      <footer className="flex flex-wrap gap-x-3 gap-y-1 px-1 pb-6 text-xs text-muted-foreground">
        <Link href={routes.legal.terms} className="hover:underline">
          服务协议
        </Link>
        <Link href={routes.legal.privacy} className="hover:underline">
          隐私政策
        </Link>
        <Link href="/about" className="hover:underline">
          关于 comit.sh
        </Link>
        <Link href={routes.globalRss} className="inline-flex items-center gap-1 hover:underline">
          <Rss className="size-3" /> RSS
        </Link>
        <span>© {new Date().getFullYear()} {siteName}</span>
      </footer>
    </div>
  );
}
