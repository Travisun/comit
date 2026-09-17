import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import {
  getActiveUserByUsername,
  getCollectionBySlug,
  getPublishedPosts,
  toFeedItemDTO,
} from "@/components/user-space/queries";
import { CollectionView } from "@/components/user-space/collection-view";
import { getCurrentUser } from "@/lib/auth/session";
import { routeParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const user = await getActiveUserByUsername(routeParam(username).toLowerCase());
  if (!user) return { title: "合集不存在", robots: { index: false, follow: false } };
  const collection = await getCollectionBySlug(user.id, routeParam(slug));
  if (!collection)
    return { title: "合集不存在", robots: { index: false, follow: false } };
  return {
    title: `${collection.name} · ${user.displayName}`,
    description: collection.description || `${user.displayName} 的合集「${collection.name}」`,
    alternates: { canonical: routes.collection(user.username, collection.slug) },
  };
}

export default async function CollectionPage({ params }: Props) {
  const { username, slug } = await params;
  const decodedSlug = routeParam(slug);
  const user = await getActiveUserByUsername(routeParam(username).toLowerCase());
  if (!user) notFound();

  const collection = await getCollectionBySlug(user.id, decodedSlug);
  if (!collection) notFound();

  const { items } = await getPublishedPosts({
    authorId: user.id,
    collectionId: collection.id,
    limit: 50,
  });
  const viewer = await getCurrentUser();

  return (
    <CollectionView
      collection={collection}
      author={user}
      items={items.map(toFeedItemDTO)}
      viewerUsername={viewer?.username}
    />
  );
}
