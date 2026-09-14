import Link from "next/link";
import { Calendar, Eye, Lock, MessageCircle } from "lucide-react";
import type { Post, User } from "@/db/schema";
import { config } from "@/core/config";
import { routes } from "@/core/routes";
import { formatDate, readingMinutes } from "@/lib/utils";
import { blogPostingJsonLd, personJsonLd } from "@/lib/seo";
import { Badge } from "@/components/ui/primitives";
import { LikeButton } from "@/components/social/like-button";
import { RepostButton } from "@/components/social/repost-button";
import { PostReactions } from "@/components/social/post-reactions";
import { Comments } from "@/components/social/comments";
import { FollowButton } from "@/components/social/follow-button";
import { ReportDialog } from "@/components/social/report-dialog";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import { TimelineHeader } from "@/components/site-shell";
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
export function PostView({
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

  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd(author)) }}
      />

      {/* sticky back bar */}
      <TimelineHeader
        back
        title={author.displayName}
        subtitle={`@${author.username}`}
        right={
          <Link
            href={routes.profile(author.username)}
            className="shrink-0 rounded-full border border-border px-3.5 py-1 text-xs font-semibold transition-colors hover:bg-[var(--hover,#f7f8f8)]"
          >
            主页
          </Link>
        }
      />

      {/* author preview banner — lifecycle states only the author can see */}
      {isSelf && post.status !== "published" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[var(--muted)] px-4 py-2 text-xs text-muted-foreground">
          <Badge variant="warning">
            {post.status === "draft"
              ? "草稿"
              : post.status === "pending_review"
                ? "审核中"
                : post.status === "deleted"
                  ? "回收站"
                  : "被驳回"}
          </Badge>
          <span>
            {post.status === "deleted"
              ? "此内容在回收站中，仅自己可见"
              : "此内容尚未发布，仅自己可见"}
          </span>
          <Link
            href={`/write/${post.id}`}
            className="ml-auto font-medium text-primary hover:underline"
          >
            继续编辑 →
          </Link>
        </div>
      )}

      <article className="px-4 pb-10">
        {/* author row */}
        <header className="pt-4">
          <div className="flex items-center gap-3">
            <Link href={routes.profile(author.username)} aria-label={author.displayName}>
              <span className="inline-block size-10 overflow-hidden rounded-full border border-border bg-muted">
                {author.avatarPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={routes.media(author.avatarPath)}
                    alt={author.displayName}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-sm font-semibold">
                    {author.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={routes.profile(author.username)}
                className="block truncate text-[15px] font-bold leading-tight hover:underline"
              >
                {author.displayName}
              </Link>
              <span className="block truncate text-sm text-muted-foreground">
                @{author.username}
              </span>
            </div>
            {!isSelf && viewer && (
              <FollowButton
                username={author.username}
                initialFollowing={viewerState.following}
                className="h-8 rounded-full px-3.5 text-xs"
              />
            )}
          </div>

          {/* badges */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AnnotationBadge label={post.label} sourceUrl={post.sourceUrl} sourceName={post.sourceName} size="md" />
            {post.visibility === "followers" && <Badge variant="secondary">关注者可见</Badge>}
            {collection && (
              <Link
                href={routes.collection(author.username, collection.slug)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                合集 · {collection.name}
              </Link>
            )}
          </div>

          {/* title */}
          <h1 className="reading-serif mt-3 text-xl font-extrabold leading-snug tracking-tight md:text-2xl">
            {post.title ?? "Untitled"}
          </h1>

          {/* meta line */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>@{author.username}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" /> {formatDate(date, "zh")}
            </span>
            <span>·</span>
            <span>{minutes} 分钟阅读</span>
          </div>
        </header>

        {/* featured image */}
        {post.coverPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={routes.media(post.coverPath)}
            alt=""
            className="mt-4 aspect-[2/1] w-full rounded-lg border border-border object-cover"
          />
        )}

        {/* body / follower gate */}
        <div className="mt-5">
          {gated ? (
            <LockedBody author={author} showLoginHint={!viewer} />
          ) : (
            <>
              {post.summary && (
                <p className="mb-6 text-[15px] leading-relaxed text-muted-foreground">
                  {post.summary}
                </p>
              )}
              <MarkdownView content={post.content} className="article-prose" />
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
        <div className="mt-3 flex items-center gap-6 border-y border-border px-1 py-2 text-muted-foreground">
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
          {viewer && <PostReactions postId={post.id} />}
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm">
            <Eye className="size-[18px]" />
            <span className="num tabular-nums">{post.views}</span>
          </span>
          {viewer && <ReportDialog targetType="post" targetId={post.id} />}
        </div>

        {/* author follow strip */}
        {!isSelf && !viewer && (
          <p className="mt-4 text-sm text-muted-foreground">
            喜欢 <Link href={routes.profile(author.username)} className="font-semibold text-foreground hover:underline">{author.displayName}</Link>{" "}
            的文章？<Link href={routes.login} className="text-primary hover:underline">登录</Link>
            后关注获取更新。
          </p>
        )}

        {/* comments */}
        <section className="mt-8" id="comments">
          <h2 className="mb-2 text-[15px] font-bold">评论</h2>
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
      <p className="mt-4 font-bold">关注后即可阅读全文</p>
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
