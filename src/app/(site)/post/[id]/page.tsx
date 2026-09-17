import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getPostForView,
  incrementPostViews,
} from "@/components/user-space/queries";
import { PostView } from "@/components/user-space/post-view";
import { ShortPostDetail } from "@/components/social/short-post-detail";

export const dynamic = "force-dynamic";

/**
 * /post/{publicId} — 帖子 permalink 唯一形态（17 位左右数字串，
 * 见 lib/public-id.ts）。非数字参数一律 404（slug/uuid 兼容已按产品决策移除）。
 */
const PUBLIC_ID_RE = /^\d{10,20}$/;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!PUBLIC_ID_RE.test(id))
    return { title: "内容不存在", robots: { index: false, follow: false } };
  const [row] = await db
    .select({
      type: posts.type,
      title: posts.title,
      summary: posts.summary,
      coverPath: posts.coverPath,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      status: posts.status,
      authorName: users.displayName,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(posts.publicId, id))
    .limit(1);
  if (!row) return { title: "内容不存在", robots: { index: false, follow: false } };

  // 非发布态内容：不下发正文片段，且禁止收录
  if (row.status !== "published")
    return { title: row.title ?? "内容不存在", robots: { index: false, follow: false } };

  const excerpt = row.summary || undefined;
  return {
    title: row.title ?? row.summary?.slice(0, 40) ?? "无题",
    description: excerpt,
    alternates: { canonical: routes.post(id) },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      publishedTime: (row.publishedAt ?? row.createdAt).toISOString(),
      authors: [row.authorName],
      images: row.coverPath ? [{ url: routes.media(row.coverPath) }] : undefined,
    },
  };
}

export default async function PostPermalinkPage({ params }: Props) {
  const { id } = await params;
  if (!PUBLIC_ID_RE.test(id)) notFound();
  const viewer = await getCurrentUser();

  const [row] = await db
    .select({ type: posts.type })
    .from(posts)
    .where(eq(posts.publicId, id))
    .limit(1);
  if (!row) notFound();

  if (row.type === "short") {
    return <ShortPostDetail publicId={id} viewer={viewer} />;
  }

  const data = await getPostForView({ publicId: id, viewer });
  // blocked visitors see a plain 404 — do not reveal the post exists
  if (!data || data === "blocked") notFound();

  const { post } = data;
  // view counter — published renders only。after() 把副作用推迟到渲染/响应
  // 完成之后执行（不阻塞 TTFB），闭包里的 post.id 在回调内依然可用
  if (post.status === "published") after(() => incrementPostViews(post.id));

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
    />
  );
}

