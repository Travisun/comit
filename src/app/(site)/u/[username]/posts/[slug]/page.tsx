import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { routes } from "@/core/routes";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string; slug: string }> };

/**
 * Legacy article URL (/u/{username}/posts/{slug}) — kept for old links;
 * canonical permalinks now live at /post/{slug}.
 */
export default async function LegacyPostPage({ params }: Props) {
  const { username, slug } = await params;
  const decodedUser = decodeURIComponent(username);
  const decodedSlug = decodeURIComponent(slug);

  const [row] = await db
    .select({ slug: posts.slug, id: posts.id })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(users.username, decodedUser), eq(posts.slug, decodedSlug)))
    .limit(1);

  redirect(routes.article(row?.slug ?? row?.id ?? decodedSlug));
}
