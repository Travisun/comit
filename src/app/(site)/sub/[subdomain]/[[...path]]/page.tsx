import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getActiveUserBySubdomain,
  getCollectionBySlug,
  getCollectionIdBySlug,
  getPostForView,
  getPublishedPosts,
  incrementPostViews,
  toFeedItemDTO,
} from "@/components/user-space/queries";
import { UserProfileView } from "@/components/user-space/profile-view";
import { PostView } from "@/components/user-space/post-view";
import { CollectionView } from "@/components/user-space/collection-view";

/**
 * Subdomain dispatcher. middleware rewrites `alice.localhost:3000/*` to
 * `/__sub/alice/*`; this optional catch-all maps:
 *   /__sub/alice                    → user profile (same view as /u/alice)
 *   /__sub/alice/posts/[slug]       → article page
 *   /__sub/alice/collections/[slug] → collection page
 * (feed.xml has its own route handler next to this file.)
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ subdomain: string; path?: string[] }> };

async function resolveUser(subdomain: string) {
  if (!(await getSetting("site.subdomains"))) return null;
  return getActiveUserBySubdomain(decodeURIComponent(subdomain).toLowerCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const user = await resolveUser(subdomain);
  if (!user) return { title: "页面不存在", robots: { index: false, follow: false } };
  const path = routes.profile(user.username);
  return {
    title: `${user.displayName} (@${user.username})`,
    description: user.bio || `${user.displayName} 的博客`,
    alternates: { canonical: path },
    openGraph: {
      images: user.avatarPath ? [{ url: routes.media(user.avatarPath) }] : undefined,
    },
  };
}

export default async function SubdomainPage({ params }: Props) {
  const { subdomain, path } = await params;

  // subdomains disabled site-wide → 404 (middleware rewrite is harmless anyway)
  const user = await resolveUser(subdomain);
  if (!user) notFound();

  const segments = path ?? [];
  const viewer = await getCurrentUser();

  // root: the user's blog home
  if (segments.length === 0) {
    return <UserProfileView user={user} viewer={viewer} viaSubdomain />;
  }

  // /posts/[slug] → article
  if (segments[0] === "posts" && segments.length === 2) {
    const data = await getPostForView({
      username: user.username,
      slug: decodeURIComponent(segments[1]),
      viewer,
    });
    if (!data || data === "blocked") notFound();
    if (data.post.status === "published") incrementPostViews(data.post.id);
    return (
      <PostView
        post={data.post}
        author={data.author}
        viewer={viewer}
        viewerState={data.followState}
        interactions={data.interactions}
        topics={data.topics}
        collection={data.collection}
        gated={data.gated}
        viaSubdomain
      />
    );
  }

  // /collections/[slug] → collection page
  if (segments[0] === "collections" && segments.length === 2) {
    const slug = decodeURIComponent(segments[1]);
    const [collection, collectionId] = await Promise.all([
      getCollectionBySlug(user.id, slug),
      getCollectionIdBySlug(user.id, slug),
    ]);
    if (!collection || !collectionId) notFound();
    const { items } = await getPublishedPosts({ authorId: user.id, collectionId, limit: 50 });
    return <CollectionView collection={collection} author={user} items={items.map(toFeedItemDTO)} />;
  }

  // unknown path shape → 404
  notFound();
}
