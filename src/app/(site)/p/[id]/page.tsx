import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { likes, posts, reposts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { routes } from "@/core/routes";
import { pageMetadata } from "@/lib/seo";
import { formatDate } from "@/lib/utils";
import { getFollowState } from "@/components/user-space/queries";
import { DetailAuthorBar } from "@/components/user-space/detail-author-bar";
import { ShortContent } from "@/components/social/short-content";
import { LikeButton } from "@/components/social/like-button";
import { RepostButton } from "@/components/social/repost-button";
import { ReportDialog } from "@/components/social/report-dialog";
import { Comments } from "@/components/social/comments";
import { PreviewBanner } from "@/components/social/preview-banner";
import { PostDetailAfterSlot } from "@/extensions/_boot/client";
import { getPollView } from "@/lib/poll-server";
import { runPostRenderPipeline } from "@/core/capabilities/post-render";
import { InterruptView } from "@/lib/plugins/registry";
import { PostActionsSlot } from "@/lib/plugins/ui";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

/** 短动态的 SEO 元数据 — 轻量查询（只取 needed 列），取不到即 404。 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

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
  if (!row)
    return { title: "动态不存在", robots: { index: false, follow: false } };

  // 标题：显式标题 → 正文截断（~60 字符）→ 作者名兜底
  const excerpt = row.excerpt?.replace(/\s+/g, " ").trim();
  const title = row.title
    ? row.title.slice(0, 60)
    : excerpt
      ? `${excerpt} · ${row.authorName}`.slice(0, 60)
      : `${row.authorName} 的动态`;

  return pageMetadata({
    title,
    description: excerpt || undefined,
    path: routes.shortPost(id),
    type: "article",
    authors: [row.authorName],
  });
}

export default async function PostPermalinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { t, locale } = await getT();
  const viewer = await getCurrentUser();

  const [row] = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(posts.id, id))
    .limit(1);
  if (!row) notFound();

  const { post, author } = row;

  const isAuthor = viewer?.id === post.authorId;
  if (post.status !== "published" && !isAuthor) notFound();

  // articles live on their canonical slug page —— 必须在 status/visibility
  // 门禁之后：提前 redirect 会让「307 vs 404」成为探测隐藏文章 slug 的 oracle
  if (post.type === "article") {
    redirect(routes.article(post.slug ?? post.id));
  }

  // 可见性门禁与 /post/[slug]（postVisibleTo + blocked → 404）对齐：
  //  - followers-only 短动态对非关注者不可经 /p/{id} 绕过（原缺陷：完全
  //    未检查 visibility，关注门禁形同虚设）；
  //  - 被作者拉黑的用户同样 404（原缺陷：未检查 blockedBy）。
  let viewerState: Awaited<ReturnType<typeof getFollowState>> | null = null;
  if (!isAuthor) {
    viewerState = await getFollowState(viewer?.id, post.authorId);
    if (viewerState.blockedBy) notFound();
    if (post.visibility === "followers" && !viewerState.following) notFound();
  }

  let liked = false;
  let reposted = false;
  if (viewer) {
    const [likeRow, repostRow] = await Promise.all([
      db
        .select({ userId: likes.userId })
        .from(likes)
        .where(
          and(
            eq(likes.userId, viewer.id),
            eq(likes.targetType, "post"),
            eq(likes.targetId, post.id),
          ),
        )
        .limit(1),
      db
        .select({ id: reposts.id })
        .from(reposts)
        .where(and(eq(reposts.userId, viewer.id), eq(reposts.postId, post.id)))
        .limit(1),
    ]);
    liked = likeRow.length > 0;
    reposted = repostRow.length > 0;
  }

  const poll = await getPollView(post.id, viewer?.id ?? null);
  const published = post.publishedAt ?? post.createdAt;

  // 扩展渲染管线（短动态正文由客户端渲染：prepend/append/meta/interrupt 生效）
  const pipeline = await runPostRenderPipeline({
    post,
    author: { id: author.id, username: author.username, displayName: author.displayName },
    viewer,
    html: "",
  });
  const interrupted = pipeline.ctx.interrupted;

  return (
    <div className="min-h-dvh w-full">
      {/* sticky author bar — identity + date live here（统一作者栏组件，与长文详情对齐） */}
      <DetailAuthorBar
        author={author}
        date={published}
        locale={locale}
        viewerPresent={Boolean(viewer)}
        isSelf={isAuthor}
        following={viewerState?.following ?? false}
        subline={
          post.status !== "published"
            ? ` · ${post.status === "deleted" ? "回收站" : t("post.draft")}`
            : undefined
        }
      />

      <article className="px-4 pb-12 md:px-5">
        {/* author preview banner — recycle bin / drafts are viewable by the author */}
        {viewer && viewer.id === post.authorId && post.status !== "published" && (
          <PreviewBanner postId={post.id} status={post.status} rejectReason={post.rejectReason} />
        )}

        {/* short-post content (optional title / paragraphs / images / poll) */}
        <div className="mt-3">
        {post.title && (
          <h1 className="reading-serif mb-1.5 text-[22px] font-normal leading-snug">{post.title}</h1>
        )}
        {interrupted ? (
          <InterruptView info={interrupted} />
        ) : (
          <>
            {pipeline.prependHtml ? (
              <div dangerouslySetInnerHTML={{ __html: pipeline.prependHtml }} />
            ) : null}
            {post.content.trim() ? (
              <ShortContent content={post.content} className="text-base" />
            ) : (
              !poll && <p className="text-sm italic text-muted-foreground">{t("feed.compose")}</p>
            )}
            {pipeline.appendHtml ? (
              <div dangerouslySetInnerHTML={{ __html: pipeline.appendHtml }} />
            ) : null}
          </>
        )}
        <PostDetailAfterSlot
          postId={post.id}
          hasPoll={Boolean(poll) && !interrupted}
          meta={pipeline.ctx.meta}
        />
      </div>

        {/* action row */}
        <div className="-mx-4 mt-4 flex flex-wrap items-center gap-1 border-y border-border px-4 py-2 md:-mx-5 md:px-5">
          <LikeButton
            targetType="post"
            targetId={post.id}
            initialCount={post.likeCount}
            initialLiked={liked}
          />
          <RepostButton
            postId={post.id}
            initialCount={post.repostCount}
            initialReposted={reposted}
          />
          {!interrupted && (
            <PostActionsSlot postId={post.id} postType={post.type} slug={post.slug} />
          )}
          <span className="flex-1" />
          {viewer && viewer.id !== author.id && (
            <ReportDialog targetType="post" targetId={post.id} />
          )}
        </div>

        <section className="mt-6" id="comments">
          <Comments
            postId={post.id}
            disabled={!author.commentsEnabled}
            initialCount={post.commentCount}
          />
        </section>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {formatDate(published, locale)}
        </p>
      </article>
    </div>
  );
}
