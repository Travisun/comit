import Link from "next/link";
import { Calendar, Eye, Lock, MessageCircle } from "lucide-react";
import type { Post, User } from "@/db/schema";
import { config } from "@/core/config";
import { routes } from "@/core/routes";
import { formatDate, readingMinutes } from "@/lib/utils";
import { blogPostingJsonLd, personJsonLd, safeJsonLd } from "@/lib/seo";
import { Badge } from "@/components/ui/primitives";
import { LikeButton } from "@/components/social/like-button";
import { RepostButton } from "@/components/social/repost-button";
import { Comments } from "@/components/social/comments";
import { FollowButton } from "@/components/social/follow-button";
import { ReportDialog } from "@/components/social/report-dialog";
import { PreviewBanner } from "@/components/social/preview-banner";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { runPostRenderPipeline } from "@/core/capabilities/post-render";
import { renderMarkdown } from "@/lib/markdown/server";
import { InterruptView } from "@/lib/plugins/registry";
import { PostActionsSlot } from "@/lib/plugins/ui";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import { DetailAuthorBar } from "@/components/user-space/detail-author-bar";
import type { TopicRef, ViewerFollowState, ViewerInteractions } from "./types";

/**
 * X-style long-form reading page, shared by:
 *  - /u/[username]/posts/[slug]
 *  - /__sub/[subdomain]/posts/[slug]
 *
 * Sticky back bar (← + author) → author row → annotation → title → summary →
 * cover → body → topics → action bar → comments → views. Handles follower-only
 * gating and JSON-LD; the caller owns 404 / blocked handling and view counting.
 */
export async function PostView({
  post,
  author,
  viewer,
  viewerState,
  interactions,
  topics,
  collection,
  gated,
  viaSubdomain = false,
}: {
  post: Post;
  author: User;
  /** full viewer row or null */
  viewer: User | null;
  viewerState: ViewerFollowState;
  interactions: ViewerInteractions;
  topics: TopicRef[];
  collection: { slug: string; name: string } | null;
  /** true ⇒ render the "follow to read" lock card instead of the body */
  gated: boolean;
  viaSubdomain?: boolean;
}) {
  const isSelf = Boolean(viewer && viewer.id === author.id);
  const date = post.publishedAt ?? post.createdAt;
  const minutes = readingMinutes(post.content);
  const canComment = Boolean(author.commentsEnabled && viewer);

  // 扩展渲染管线：前/后输出、正文改写、meta、打断（gated 时由关注门禁接管）
  const pipeline = gated
    ? null
    : await runPostRenderPipeline({
        post,
        author: { id: author.id, username: author.username, displayName: author.displayName },
        viewer,
        html: (await renderMarkdown(post.content)).html,
      });

  return (
    <div className="min-h-dvh w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(
            blogPostingJsonLd({
              post,
              author: { displayName: author.displayName, username: author.username },
              url: `${config.app.url}${routes.article(post.slug ?? post.id)}`,
              topics: topics.map((t) => t.name),
            }),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(personJsonLd(author)) }}
      />

      {/* author preview banner — lifecycle states only the author can see */}
      {isSelf && post.status !== "published" && (
        <PreviewBanner
          postId={post.id}
          status={post.status}
          rejectReason={post.rejectReason}
        />
      )}

      {/* sticky author bar — identity + follow live here, no duplicate row below（统一作者栏组件） */}
      <DetailAuthorBar
        author={author}
        date={date}
        viewerPresent={Boolean(viewer)}
        isSelf={isSelf}
        following={viewerState.following}
      />

      <article className="px-4 pb-12 md:px-5">
        {/* title */}
          <h1 className="reading-serif mt-3 text-balance text-[26px] font-normal leading-snug md:text-[30px]">
            {post.title ??
              post.summary?.slice(0, 40) ??
              post.content.replace(/[#>*`\[\]]/g, "").slice(0, 40) ??
              "无题"}
          </h1>

          {/* meta line — 标注/可见性/合集与日期同级排布，共用一套文字样式 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" /> {formatDate(date, "zh")}
            </span>
            <span>·</span>
            <span className="num">{minutes} 分钟</span>
            <AnnotationBadge label={post.label} sourceUrl={post.sourceUrl} sourceName={post.sourceName} size="sm" />
            {post.visibility === "followers" && <Badge variant="secondary">关注者可见</Badge>}
            {collection && (
              <Link
                href={routes.collection(author.username, collection.slug)}
                className="transition-colors hover:text-foreground"
              >
                合集 · {collection.name}
              </Link>
            )}
          </div>

        {/* featured image */}
        {post.coverPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={routes.media(post.coverPath)}
            alt=""
            className="mt-4 aspect-[2/1] w-full rounded-lg border border-border object-cover"
          />
        )}

        {/* body / follower gate / 扩展渲染管线（前/后输出 + 打断） */}
        <div className="mt-5">
          {gated ? (
            <LockedBody author={author} showLoginHint={!viewer} />
          ) : pipeline?.ctx.interrupted ? (
            <InterruptView info={pipeline.ctx.interrupted} />
          ) : (
            <>
              {post.summary && (
                <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
                  {post.summary}
                </p>
              )}
              {pipeline?.prependHtml ? (
                <div dangerouslySetInnerHTML={{ __html: pipeline.prependHtml }} />
              ) : null}
              <MarkdownView
                content={post.content}
                className="article-prose"
                html={pipeline?.ctx.html}
              />
              {pipeline?.appendHtml ? (
                <div dangerouslySetInnerHTML={{ __html: pipeline.appendHtml }} />
              ) : null}
            </>
          )}
        </div>

        {/* topics */}
        {topics.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-4">
            {topics.map((t) => (
              <Link
                key={t.slug}
                href={routes.topic(t.slug)}
                className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-primary"
              >
                # {t.name}
              </Link>
            ))}
          </div>
        )}

        {/* detail action bar */}
        <div className="-mx-4 mt-3 flex items-center gap-6 border-y border-border px-4 py-2 text-muted-foreground md:-mx-5 md:px-5">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <MessageCircle className="size-[18px]" />
            <span className="num tabular-nums">{post.commentCount}</span>
          </span>
          <RepostButton
            postId={post.id}
            initialCount={post.repostCount}
            initialReposted={interactions.reposted}
          />
          <LikeButton
            targetType="post"
            targetId={post.id}
            initialCount={post.likeCount}
            initialLiked={interactions.liked}
          />
          <PostActionsSlot postId={post.id} postType={post.type} slug={post.slug} />
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm">
            <Eye className="size-[18px]" />
            <span className="num tabular-nums">{post.views}</span>
          </span>
          {viewer && <ReportDialog targetType="post" targetId={post.id} />}
        </div>

        {/* author follow strip */}
        {!isSelf && !viewer && (
          <p className="mt-4 text-sm text-muted-foreground">
            喜欢 <Link href={routes.profile(author.username)} className="font-medium text-foreground hover:underline">{author.displayName}</Link>{" "}
            的文章？<Link href={routes.login} className="text-primary hover:underline">登录</Link>
            后关注获取更新。
          </p>
        )}

        {/* comments */}
        <section className="mt-8" id="comments">
          <Comments
            postId={post.id}
            disabled={!canComment}
            initialCount={post.commentCount}
          />
        </section>

        {viaSubdomain && (
          <p className="mt-10 text-center text-xs text-muted-foreground">
            由 {config.app.name} 驱动 · {routes.article(post.slug ?? post.id)}
          </p>
        )}
      </article>
    </div>
  );
}

/** Followers-only lock card with an inline follow action. */
function LockedBody({ author, showLoginHint }: { author: User; showLoginHint: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Lock className="size-6" />
      </span>
      <p className="mt-4 font-normal">关注后即可阅读全文</p>
      <p className="mt-1 text-sm text-muted-foreground">
        本文仅对 {author.displayName} 的关注者可见
      </p>
      <div className="mt-5 flex justify-center">
        <FollowButton username={author.username} initialFollowing={false} />
      </div>
      {showLoginHint && (
        <p className="mt-3 text-xs text-muted-foreground">
          已有账号？<Link href={routes.login} className="text-primary hover:underline">登录</Link>
        </p>
      )}
    </div>
  );
}
