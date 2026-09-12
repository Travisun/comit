import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getPostForView,
  incrementPostViews,
} from "@/components/user-space/queries";
import { PostView } from "@/components/user-space/post-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const decodedUser = decodeURIComponent(username);
  const viewer = await getCurrentUser().catch(() => null);
  const data = await getPostForView({ username: decodedUser, slug: decodeURIComponent(slug), viewer });
  if (!data || data === "blocked") return { title: "文章不存在" };
  const { post, author, topics } = data;
  return {
    title: post.title ?? "Untitled",
    description: post.summary || undefined,
    alternates: { canonical: routes.post(author.username, post.slug ?? "") },
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

export default async function PostPage({ params }: Props) {
  const { username, slug } = await params;
  const viewer = await getCurrentUser();

  const data = await getPostForView({
    username: decodeURIComponent(username),
    slug: decodeURIComponent(slug),
    viewer,
  });
  // blocked visitors see a plain 404 — do not reveal the post exists
  if (!data || data === "blocked") notFound();

  const { post, author, topics, collection, followState, interactions, gated } = data;

  // fire-and-forget view counter (published renders only)
  if (post.status === "published") incrementPostViews(post.id);

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
