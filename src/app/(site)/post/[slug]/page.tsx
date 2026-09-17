import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
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
import { routeParam } from "@/lib/route-params";
import type { User } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ slug: string }> };

/**
 * /post/{param} — 帖子 permalink 统一入口：
 *  - param 为 internalId（canonical 形态，routes.post 生成）；
 *  - param 为 slug 时按 slug 解析（历史/SEO 链接兼容）；
 *  - id 命中短动态时渲染短动态详情（原 /p/{id} 已 308 到此）。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: rawParam } = await params;
  const param = routeParam(rawParam);
  const viewer = await getCurrentUser().catch(() => null);

  if (UUID_RE.test(param)) {
    // id 形态：短动态走轻量 metadata；长文（有 slug）复用 slug 链路的 metadata
    const [row] = await db
      .select({ type: posts.type, slug: posts.slug })
      .from(posts)
      .where(eq(posts.id, param))
      .limit(1);
    if (!row) return { title: "内容不存在", robots: { index: false, follow: false } };
    if (row.type === "short") return shortPostMetadata(param);
    if (!row.slug) return { title: "内容不存在", robots: { index: false, follow: false } };
    return articleMetadata(row.slug, viewer);
  }
  return articleMetadata(param, viewer);
}

/** 短动态 SEO 元数据 — 轻量查询（只取 needed 列）。 */
async function shortPostMetadata(id: string): Promise<Metadata> {
  const [row] = await db
    .select({
      title: posts.title,
      // 只截取正文前 60 字符做标题兜底，避免整段 content 出网络
      excerpt: sql<string>`left(${posts.content}, 60)`,
      authorName: users.displayName,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    // 仅已发布内容参与 SEO：否则草稿/回收站/followers-only 的正文片段会经
    // <meta description> 泄露（notFound 时 Next 仍会渲染已生成的 metadata）
    .where(and(eq(posts.id, id), eq(posts.status, "published")))
    .limit(1);
  if (!row) return { title: "动态不存在", robots: { index: false, follow: false } };

  // 标题：显式标题 → 正文截断（~60 字符）→ 作者名兜底
  const excerpt = row.excerpt?.replace(/\s+/g, " ").trim();
  const title = row.title
    ? row.title.slice(0, 60)
    : excerpt
      ? `${excerpt} · ${row.authorName}`.slice(0, 60)
      : `${row.authorName} 的动态`;

  return {
    title,
    description: excerpt || undefined,
    alternates: { canonical: routes.post(id) },
    openGraph: { type: "article", authors: [row.authorName] },
  };
}

/** 长文 SEO 元数据（slug 链路；canonical 统一指向 /post/{internalId}）。 */
async function articleMetadata(slug: string, viewer: User | null): Promise<Metadata> {
  const data = await getPostForView({ slug, viewer });
  if (!data || data === "blocked")
    return { title: "文章不存在", robots: { index: false, follow: false } };
  const { post, author, topics, gated } = data;
  // 非发布态或 followers-gated 的内容：描述不下发全文 summary，且禁止收录
  //（避免关注门禁被 meta description 泄露绕过）
  const secretive = gated || post.status !== "published";
  return {
    title: post.title ?? post.summary?.slice(0, 40) ?? "无题",
    description: secretive ? undefined : post.summary || undefined,
    alternates: { canonical: routes.post(post.id) },
    robots: secretive ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "article",
      publishedTime: (post.publishedAt ?? post.createdAt).toISOString(),
      authors: [author.displayName],
      tags: topics.map((t) => t.name),
      images: post.coverPath ? [{ url: routes.media(post.coverPath) }] : undefined,
    },
  };
}

export default async function PostPermalinkPage({ params }: Props) {
  const { slug: rawParam } = await params;
  const param = routeParam(rawParam);
  const viewer = await getCurrentUser();

  if (UUID_RE.test(param)) {
    // id 形态：先辨类型 —— 短动态渲染短动态详情，长文落到 slug 链路
    const [row] = await db
      .select({ type: posts.type, slug: posts.slug, status: posts.status })
      .from(posts)
      .where(eq(posts.id, param))
      .limit(1);
    if (!row) notFound();
    if (row.type === "short") return <ShortPostDetail postId={param} viewer={viewer} />;
    if (!row.slug) notFound();
    return <ArticleDetail slug={row.slug} viewer={viewer} />;
  }
  return <ArticleDetail slug={param} viewer={viewer} />;
}

/** 长文详情渲染体（blocked 访客一律 404，不泄露帖子存在性）。 */
async function ArticleDetail({ slug, viewer }: { slug: string; viewer: User | null }) {
  const data = await getPostForView({ slug, viewer });
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
