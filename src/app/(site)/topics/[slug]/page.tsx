import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getPublishedPosts, getTopicBySlug, toFeedItemDTO } from "@/components/user-space/queries";
import { TimelineHeader } from "@/components/site-shell";
import { ArticleCard, FEED_ROW_CLASS } from "@/components/user-space/article-card";
import { ShortCard } from "@/components/user-space/short-card";
import { getCurrentUser } from "@/lib/auth/session";
import { routeParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopicBySlug(routeParam(slug));
  if (!topic) return { title: "话题不存在", robots: { index: false, follow: false } };
  return {
    title: `#${topic.name}`,
    description: topic.description || `话题「${topic.name}」下的全部文章。`,
    alternates: { canonical: routes.topic(topic.slug) },
  };
}

export default async function TopicPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);

  const topic = await getTopicBySlug(routeParam(slug));
  if (!topic) notFound();

  const viewer = await getCurrentUser();
  const viewerUsername = viewer?.username;
  const { items, nextOffset } = await getPublishedPosts({
    viewerId: viewer?.id,
    topicSlug: topic.slug,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const pageHref = (p: number) => (p === 0 ? routes.topic(topic.slug) : `${routes.topic(topic.slug)}?page=${p}`);
  const pagerCls =
    "rounded-full border border-border px-4 py-1.5 font-semibold transition-colors hover:bg-hover";

  return (
    <div className="min-h-dvh w-full pt-[10px]">
      <TimelineHeader title={`# ${topic.name}`} subtitle={`${topic.postCount} 条公开内容`} paddingClass="px-5" />

      {topic.description && (
        <p className="border-b border-border px-5 py-3 text-sm leading-relaxed text-muted-foreground">
          {topic.description}
        </p>
      )}

      {/* post stream — X-style rows */}
      <div>
        {items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            该话题下还没有公开内容
          </div>
        ) : (
          items.map((it) => {
            const dto = toFeedItemDTO(it);
            return dto.post.type === "short" ? (
              <ShortCard
                key={it.post.id}
                post={dto.post}
                author={dto.author}
                className={FEED_ROW_CLASS}
                viewerUsername={viewerUsername}
                rowHref
                menu={Boolean(viewerUsername)}
              />
            ) : (
              <ArticleCard
                key={it.post.id}
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
      </div>

      {(page > 0 || nextOffset !== null) && (
        <nav className="flex items-center justify-between px-5 py-4 text-sm" aria-label="Pagination">
          {page > 0 ? (
            <Link href={pageHref(page - 1)} className={pagerCls}>
              上一页
            </Link>
          ) : (
            <span />
          )}
          {nextOffset !== null ? (
            <Link href={pageHref(page + 1)} className={pagerCls}>
              下一页
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
