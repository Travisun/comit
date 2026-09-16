import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getPostForView,
  incrementPostViews,
} from "@/components/user-space/queries";
import { PostView } from "@/components/user-space/post-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const viewer = await getCurrentUser().catch(() => null);
  const data = await getPostForView({ slug: decodedSlug, viewer });
  if (!data || data === "blocked") return { title: "文章不存在" };
  const { post, author, topics } = data;
  return {
    title: post.title ?? post.summary?.slice(0, 40) ?? "无题",
    description: post.summary || undefined,
    alternates: { canonical: routes.article(post.slug ?? "") },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      publishedTime: (post.publishedAt ?? post.createdAt).toISOString(),
      authors: [author.displayName],
      tags: topics.map((t) => t.name),
      images: post.coverPath ? [{ url: routes.media(post.coverPath) }] : undefined,
    },
  };
}

export default async function ArticlePermalinkPage({ params }: Props) {
  const { slug } = await params;
  const viewer = await getCurrentUser();

  const data = await getPostForView({
    slug: decodeURIComponent(slug),
    viewer,
  });
  // blocked visitors see a plain 404 — do not reveal the post exists
  if (!data || data === "blocked") notFound();

  const { post, author, topics, collection, followState, interactions, gated } = data;

  // view counter — published renders only。after() 把副作用推迟到渲染/响应
  // 完成之后执行（不阻塞 TTFB），闭包里的 post.id 在回调内依然可用
  if (post.status === "published") after(() => incrementPostViews(post.id));

  return (
    <PostView
      post={post}
      author={author}
      viewer={viewer}
      viewerState={followState}
      interactions={interactions}
      topics={topics}
      collection={collection}
      gated={gated}
    />
  );
}
