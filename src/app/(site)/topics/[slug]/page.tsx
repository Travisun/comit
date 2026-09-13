import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getPublishedPosts, getTopicBySlug, toFeedItemDTO } from "@/components/user-space/queries";
import { TimelineHeader } from "@/components/site-shell";
import { ArticleCard } from "@/components/user-space/article-card";
import { ShortCard } from "@/components/user-space/short-card";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopicBySlug(decodeURIComponent(slug));
  if (!topic) return { title: "话题不存在" };
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

  const topic = await getTopicBySlug(decodeURIComponent(slug));
  if (!topic) notFound();

  const { items, nextOffset } = await getPublishedPosts({
    topicSlug: topic.slug,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const pageHref = (p: number) => (p === 0 ? routes.topic(topic.slug) : `${routes.topic(topic.slug)}?page=${p}`);
  const pagerCls =
    "rounded-full border border-border px-4 py-1.5 font-semibold transition-colors hover:bg-[var(--hover,#f7f8f8)]";

  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      <TimelineHeader title={`# ${topic.name}`} subtitle={`${topic.postCount} 条公开内容`} />

      {topic.description && (
        <p className="border-b border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {topic.description}
        </p>
      )}

      {/* post stream — X-style rows */}
      <div>
        {items.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            该话题下还没有公开内容
          </div>
        ) : (
          items.map((it) => {
            const dto = toFeedItemDTO(it);
            return dto.post.type === "short" ? (
              <ShortCard key={it.post.id} post={dto.post} author={dto.author} />
            ) : (
              <ArticleCard key={it.post.id} post={dto.post} author={dto.author} variant="list" />
            );
          })
        )}
      </div>

      {(page > 0 || nextOffset !== null) && (
        <nav className="flex items-center justify-between px-4 py-4 text-sm" aria-label="Pagination">
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
