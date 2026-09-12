import Link from "next/link";
import { Hash, Rss } from "lucide-react";
import { routes } from "@/core/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import type { AuthorCardData, TopicRef } from "@/components/user-space/types";
import type { CommunityStats } from "@/components/user-space/queries";

/**
 * Global right rail for the X-style shell (≥1280px only, rendered by the
 * site layout): search → about comit.sh → trending topics → active authors
 * → footer links. Flat bordered cards, no shadows.
 */
export function SiteRail({
  siteName,
  topics,
  authors,
  stats,
}: {
  siteName: string;
  topics: TopicRef[];
  authors: AuthorCardData[];
  stats: CommunityStats | null;
}) {
  return (
    <div className="space-y-4">
      {/* search — GET /explore?q= */}
      <form action={routes.explore} role="search" className="sticky top-3 z-10 bg-card pb-1">
        <label className="flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2.5 transition-colors focus-within:border-primary/50 focus-within:bg-card">
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

      {/* what is comit.sh */}
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-[15px] font-bold">{siteName} 是什么</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          极客 · 设计师 · 科学家 · CS 学子的个人品牌社区 —— 记录科研日志、技术学习、研究发布与项目动态。
        </p>
        {stats && (
          <p className="num mt-2 text-xs text-muted-foreground">
            {stats.members} 位成员 · {stats.posts} 篇公开内容 · 今日 {stats.today} 条动态
          </p>
        )}
        <Link
          href="/about"
          className="mt-2.5 inline-block text-sm font-medium text-primary hover:underline"
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
