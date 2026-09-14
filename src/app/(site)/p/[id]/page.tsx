import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { likes, posts, reposts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { routes } from "@/core/routes";
import { formatDate, timeAgo } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { TimelineHeader } from "@/components/site-shell";
import { ShortContent } from "@/components/social/short-content";
import { LikeButton } from "@/components/social/like-button";
import { RepostButton } from "@/components/social/repost-button";
import { PostReactions } from "@/components/social/post-reactions";
import { ReportDialog } from "@/components/social/report-dialog";
import { Comments } from "@/components/social/comments";
import { PreviewBanner } from "@/components/social/preview-banner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // articles live on their canonical slug page
  if (post.type === "article") {
    redirect(routes.article(post.slug ?? post.id));
  }

  const isAuthor = viewer?.id === post.authorId;
  if (post.status !== "published" && !isAuthor) notFound();

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

  const published = post.publishedAt ?? post.createdAt;

  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      {/* sticky back bar */}
      <TimelineHeader
        back
        title={author.displayName}
        subtitle={`@${author.username}`}
      />

      <article className="px-4 pb-10">
        {/* author card */}
        <header className="flex items-center gap-3 pt-4">
          <Link href={routes.profile(author.username)} aria-label={author.displayName}>
            <Avatar className="size-10 border border-border">
              {author.avatarPath && (
                <AvatarImage src={routes.media(author.avatarPath)} alt={author.displayName} />
              )}
              <AvatarFallback>{author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={routes.profile(author.username)}
              className="block truncate text-[15px] font-bold text-foreground hover:underline"
            >
              {author.displayName}
            </Link>
            <p className="truncate text-sm text-muted-foreground">
              @{author.username} · {timeAgo(published, locale)}
              {post.status !== "published" && ` · ${post.status === "deleted" ? "回收站" : t("post.draft")}`}
            </p>
          </div>
        </header>

        {/* author preview banner — recycle bin / drafts are viewable by the author */}
        {viewer && viewer.id === post.authorId && post.status !== "published" && (
          <PreviewBanner postId={post.id} status={post.status} rejectReason={post.rejectReason} />
        )}

        {/* short-post content (paragraphs / line breaks / images) */}
        <div className="mt-3">
        {post.content.trim() ? (
          <ShortContent content={post.content} className="text-base" />
        ) : (
          <p className="text-sm italic text-muted-foreground">{t("feed.compose")}</p>
        )}
      </div>

        {/* action row */}
        <div className="mt-4 flex flex-wrap items-center gap-1 border-y border-border py-2">
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
          {viewer && <PostReactions postId={post.id} />}
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
