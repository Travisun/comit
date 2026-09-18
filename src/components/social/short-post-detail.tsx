import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { likes, posts, reposts, users } from "@/db/schema";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { getFollowState } from "@/components/user-space/queries";
import { DetailAuthorBar } from "@/components/user-space/detail-author-bar";
import { ShortContent } from "@/components/social/short-content";
import { LikeButton } from "@/components/social/like-button";
import { RepostButton } from "@/components/social/repost-button";
import { ReportDialog } from "@/components/social/report-dialog";
import { Comments } from "@/components/social/comments";
import { SolutionsBox } from "@/components/social/solutions-box";
import { PreviewBanner } from "@/components/social/preview-banner";
import { PostDetailAfterSlot } from "@/extensions/_boot/client";
import { getPollView } from "@/lib/poll-server";
import { runPostRenderPipeline } from "@/core/capabilities/post-render";
import { InterruptView } from "@/lib/plugins/registry";
import { PostActionsSlot } from "@/lib/plugins/ui";
import type { User } from "@/db/schema";

/**
 * 短动态详情视图 — 由 /post/{internalId}（canonical）渲染。
 * 含可见性门禁（followers-only / 拉黑 → 404，与长文详情对齐）、
 * 统一作者栏、扩展渲染管线、动作行与评论区。
 */
export async function ShortPostDetail({
  publicId,
  viewer,
}: {
  /** 对外短 ID（/post/{publicId} canonical 形态） */
  publicId: string;
  /** 已登录观众完整行；匿名传 null */
  viewer: User | null;
}) {
  const { t, locale } = await getT();

  const [row] = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(posts.publicId, publicId))
    .limit(1);
  if (!row) notFound();

  const { post, author } = row;

  const isAuthor = viewer?.id === post.authorId;
  if (post.status !== "published" && !isAuthor) notFound();

  // 可见性门禁与长文详情（postVisibleTo + blocked → 404）对齐：
  //  - followers-only 短动态对非关注者不可绕过；
  //  - private（仅自己可见）对非作者一律 404；
  //  - 被作者拉黑的用户同样 404。
  let viewerState: Awaited<ReturnType<typeof getFollowState>> | null = null;
  if (!isAuthor) {
    viewerState = await getFollowState(viewer?.id, post.authorId);
    if (viewerState.blockedBy) notFound();
    if (post.visibility === "followers" && !viewerState.following) notFound();
    if (post.visibility === "private") notFound();
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
            <PostActionsSlot postId={post.id} postType={post.type} publicId={post.publicId} />
          )}
          <span className="flex-1" />
          {viewer && viewer.id !== author.id && (
            <ReportDialog targetType="post" targetId={post.id} />
          )}
        </div>

        {/* 解决方案摘要盒：正文尾部、评论区之前 */}
        <SolutionsBox postId={post.id} disabled={!author.commentsEnabled} />

        <section className="mt-6" id="comments">
          <Comments
            postId={post.id}
            disabled={!author.commentsEnabled}
            initialCount={post.commentCount}
            viewer={viewer}
          />
        </section>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {formatDate(published, locale)}
        </p>
      </article>
    </div>
  );
}
