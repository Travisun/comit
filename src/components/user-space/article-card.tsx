import Link from "next/link";
import { Heart, MessageCircle, Pin, Repeat2 } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { routes } from "@/core/routes";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui/primitives";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import type { FeedItemDTO } from "./types";

/**
 * X-style timeline row (article flavor). Pure (no hooks / no server-only
 * imports) so it can be rendered from server pages and from the client-side
 * feed stream alike. Flat: no card border / radius / shadow — rows are
 * separated by 1px borders and tinted on hover.
 */

export function postHref(post: FeedItemDTO["post"], author: FeedItemDTO["author"]): string {
  return post.slug ? routes.article(post.slug) : routes.shortPost(post.id);
}

/** The shared timeline row shell: 40px avatar + content column. */
export function TimelineRow({
  author,
  children,
  className,
}: {
  author: FeedItemDTO["author"];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-[var(--hover,#f7f8f8)]",
        className,
      )}
    >
      <Link href={routes.profile(author.username)} className="shrink-0" aria-label={author.displayName}>
        <Avatar className="size-10">
          {author.avatarPath && (
            <AvatarImage src={routes.media(author.avatarPath)} alt={author.displayName} />
          )}
          <AvatarFallback>{author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
    </article>
  );
}

/** Bold name + @username + · relative time + visibility chip. */
export function TimelineAuthorLine({
  post,
  author,
  href,
}: {
  post?: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  href?: string;
}) {
  const date = post?.publishedAt ? new Date(post.publishedAt) : null;
  return (
    <div className="flex min-w-0 items-center gap-1 text-[15px] leading-tight">
      <Link
        href={routes.profile(author.username)}
        className="truncate font-bold hover:underline"
      >
        {author.displayName}
      </Link>
      <span className="truncate text-muted-foreground">@{author.username}</span>
      {date && (
        <>
          <span className="shrink-0 text-muted-foreground">·</span>
          <Link href={href ?? routes.profile(author.username)} className="shrink-0 text-muted-foreground hover:underline">
            <time dateTime={date.toISOString()}>{timeAgo(date, "zh")}</time>
          </Link>
        </>
      )}
      {post?.visibility === "followers" && (
        <Badge variant="secondary" className="ml-1 shrink-0">
          关注者可见
        </Badge>
      )}
    </div>
  );
}

/** Static X-style action strip: reply / repost / like (hover blue/green/red). */
export function TimelineActions({
  post,
  href,
  className,
}: {
  post: FeedItemDTO["post"];
  href: string;
  className?: string;
}) {
  return (
    <div className={cn("mt-2 flex max-w-sm items-center justify-between text-muted-foreground", className)}>
      <Link
        href={href}
        className="group/a inline-flex items-center gap-1 text-xs transition-colors hover:text-sky-500"
        aria-label="评论"
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/a:bg-sky-500/10">
          <MessageCircle className="size-4" />
        </span>
        {post.commentCount > 0 && <span className="num tabular-nums">{post.commentCount}</span>}
      </Link>
      <span
        className="group/r inline-flex cursor-pointer items-center gap-1 text-xs transition-colors hover:text-emerald-500"
        aria-label="转推"
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/r:bg-emerald-500/10">
          <Repeat2 className="size-4" />
        </span>
        {post.repostCount > 0 && <span className="num tabular-nums">{post.repostCount}</span>}
      </span>
      <span
        className="group/l inline-flex cursor-pointer items-center gap-1 text-xs transition-colors hover:text-rose-500"
        aria-label="喜欢"
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/l:bg-rose-500/10">
          <Heart className="size-4" />
        </span>
        {post.likeCount > 0 && <span className="num tabular-nums">{post.likeCount}</span>}
      </span>
    </div>
  );
}

export function ArticleCard({
  post,
  author,
  variant = "grid",
  showAuthor = true,
  className,
  pinned = false,
}: {
  post: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  /** kept for API compat; "grid" renders a full-width cover, "list" a side thumbnail */
  variant?: "grid" | "list";
  showAuthor?: boolean;
  className?: string;
  /** render the pinned「代表作」label above the row content */
  pinned?: boolean;
}) {
  const href = postHref(post, author);
  const cover = post.coverPath ? routes.media(post.coverPath) : null;
  const thumb = variant === "list" && cover;

  return (
    <TimelineRow author={author} className={className}>
      {pinned && (
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Pin className="size-3.5" /> 代表作
        </p>
      )}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          {showAuthor && <TimelineAuthorLine post={post} author={author} href={href} />}
          {post.label && (
            <div className="mt-1">
              <AnnotationBadge label={post.label} sourceUrl={post.sourceUrl} sourceName={post.sourceName} size="sm" />
            </div>
          )}
          <h3 className="mt-0.5 text-[15px] font-bold leading-snug">
            <Link href={href} className="line-clamp-2 hover:underline">
              {post.title ?? "Untitled"}
            </Link>
          </h3>
          {post.summary && (
            <p className="mt-0.5 line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">
              {post.summary}
            </p>
          )}
        </div>
        {thumb && (
          <Link
            href={href}
            tabIndex={-1}
            aria-hidden
            className="hidden size-24 shrink-0 overflow-hidden rounded-lg bg-[var(--muted)] sm:block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover ?? ""} alt="" loading="lazy" className="size-full object-cover" />
          </Link>
        )}
      </div>
      {cover && !thumb && (
        <Link href={href} tabIndex={-1} aria-hidden className="mt-2 block overflow-hidden rounded-lg bg-[var(--muted)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" loading="lazy" className="aspect-[2/1] w-full object-cover" />
        </Link>
      )}
      <TimelineActions post={post} href={href} />
    </TimelineRow>
  );
}
