import Link from "next/link";
import type { Metadata } from "next";
import { Search, TrendingUp } from "lucide-react";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import {
  getActiveAuthors,
  getHotPosts,
  getTrendingTopics,
  searchPublishedPosts,
  toFeedItemDTO,
} from "@/components/user-space/queries";
import { TimelineHeader } from "@/components/site-shell";
import { ArticleCard, FEED_ROW_CLASS } from "@/components/user-space/article-card";
import { ShortCard } from "@/components/user-space/short-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现",
  description: "热门话题、热门文章与活跃作者。",
  alternates: { canonical: routes.explore },
};

type Props = { searchParams: Promise<{ q?: string }> };

export default async function ExplorePage({ searchParams }: Props) {
  const { q: qParam } = await searchParams;
  const q = (qParam ?? "").trim();

  const [{ t }, topics, hot, authors, results, viewer] = await Promise.all([
    getT(),
    getTrendingTopics(30),
    getHotPosts(10),
    getActiveAuthors(12),
    q ? searchPublishedPosts(q, 20) : Promise.resolve([]),
    getCurrentUser(),
  ]);
  const viewerUsername = viewer?.username;

  const maxTopic = Math.max(1, ...topics.map((tp) => tp.postCount));

  return (
    <div className="min-h-dvh w-full py-[10px]">
      <TimelineHeader title="发现" right={<TrendingUp className="size-5 text-muted-foreground" aria-hidden />} />

      {/* search — mirrors the rail search for < xl viewports */}
      <form action={routes.explore} role="search" className="border-b border-border px-5 py-3">
        <label className="flex items-center gap-2 rounded-full border border-border bg-muted px-5 py-2.5 transition-colors focus-within:border-primary/50 focus-within:bg-card">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("nav.search")}
            aria-label="搜索"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </form>

      {/* search results */}
      {q && (
        <section aria-label="搜索结果">
          <h2 className="border-b border-border px-5 pb-2 pt-3 text-sm text-muted-foreground">
            “{q}” 的搜索结果 · {results.length} 条
          </h2>
          {results.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">
              没有匹配的内容，换个关键词试试。
            </div>
          ) : (
            results.map((it) => {
              const dto = toFeedItemDTO(it);
              return dto.post.type === "short" ? (
                <ShortCard
                  key={dto.post.id}
                  post={dto.post}
                  author={dto.author}
                  className={FEED_ROW_CLASS}
                  viewerUsername={viewerUsername}
                  rowHref
                  menu={Boolean(viewerUsername)}
                />
              ) : (
                <ArticleCard
                  key={dto.post.id}
                  post={dto.post}
                  author={dto.author}
                  variant="list"
                  className={FEED_ROW_CLASS}
                  viewerUsername={viewerUsername}
                  rowHref
                  menu={Boolean(viewerUsername)}
                />
              );
            })
          )}
        </section>
      )}

      {/* topic ranking */}
      <section className="border-b border-border">
        <h2 className="px-5 pb-1 pt-3 text-[15px] font-normal">{t("user.topicCloud")}</h2>
        {topics.length === 0 ? (
          <Empty text="还没有话题，发布文章时添加话题后会出现在这里。" />
        ) : (
          <ol className="px-5 pb-2.5">
            {topics.slice(0, 15).map((tp, i) => (
              <li key={tp.slug}>
                <Link
                  href={routes.topic(tp.slug)}
                  className="flex rounded-lg items-baseline gap-3 px-2.5 py-2.5 transition-colors hover:bg-[var(--hover,#f7f8f8)] focus-visible:bg-[var(--hover,#f7f8f8)] focus-visible:outline-none"
                >
                  <span className="num w-4 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">#{tp.name}</span>
                    <span className="num block text-xs text-muted-foreground">
                      {tp.postCount} 条内容 · 热度 {Math.round((tp.postCount / maxTopic) * 100)}
                    </span>
                  </span>
                  <TrendingUp className="size-4 shrink-0 self-center text-muted-foreground/60" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* hot posts */}
      <section className="border-b border-border">
        <h2 className="px-5 pb-1 pt-3 text-[15px] font-normal">{t("home.trending")}</h2>
        {hot.length === 0 ? (
          <Empty text="暂无热门内容。" />
        ) : (
          <ol className="px-5 pb-2.5">
            {hot.map((it, i) => (
              <li key={it.post.id}>
                <Link
                  href={routes.post(it.post.id)}
                  className="flex rounded-lg items-baseline gap-3 px-2.5 py-2.5 transition-colors hover:bg-[var(--hover,#f7f8f8)] focus-visible:bg-[var(--hover,#f7f8f8)] focus-visible:outline-none"
                >
                  <span className="num w-4 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {it.post.title ?? "Untitled"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{it.author.username}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* active authors */}
      <section>
        <h2 className="px-5 pb-1 pt-3 text-[15px] font-normal">{t("home.featuredAuthors")}</h2>
        {authors.length === 0 ? (
          <Empty text="还没有活跃作者。" />
        ) : (
          <ul className="px-5">
            {authors.map((a) => (
              <li key={a.username}>
                <Link
                  href={routes.profile(a.username)}
                  className="flex rounded-lg items-center gap-3 px-2.5 py-3 transition-colors hover:bg-[var(--hover,#f7f8f8)] focus-visible:bg-[var(--hover,#f7f8f8)] focus-visible:outline-none"
                >
                  <Avatar className="size-10">
                    {a.avatarPath && (
                      <AvatarImage src={routes.media(a.avatarPath)} alt={a.displayName} />
                    )}
                    <AvatarFallback>{a.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-normal">{a.displayName}</span>
                    <span className="block truncate text-sm text-muted-foreground">@{a.username}</span>
                  </span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {a.postCount} 篇 · {a.followerCount} {t("user.followers")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-6 py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
