import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { postTopics, posts, topics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/core/routes";
import { ArticleEditor, type EditorPost } from "@/components/editor/article-editor";

/**
 * /write/[id] — edit one of the current user's posts (non-authors get 404).
 */
export const metadata: Metadata = { title: "编辑文章" };

export default async function WriteEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.authorId, user.id)))
    .limit(1);
  if (!post) notFound();

  const topicRows = await db
    .select({ name: topics.name })
    .from(postTopics)
    .innerJoin(topics, eq(topics.id, postTopics.topicId))
    .where(eq(postTopics.postId, post.id));

  const initial: EditorPost = {
    id: post.id,
    title: post.title,
    content: post.content,
    summary: post.summary,
    slug: post.slug,
    status: post.status,
    visibility: post.visibility,
    collectionId: post.collectionId,
    coverPath: post.coverPath,
    topicNames: topicRows.map((r) => r.name),
    rejectReason: post.rejectReason,
    label: post.label,
    sourceUrl: post.sourceUrl,
    sourceName: post.sourceName,
  };

  return <ArticleEditor initial={initial} />;
}
