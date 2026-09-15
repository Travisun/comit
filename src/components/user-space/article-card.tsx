"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Heart, MessageCircle, Pin, Repeat2 } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { routes } from "@/core/routes";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui/primitives";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import { postHref } from "./post-href";
import { RowActionsMenu } from "./row-actions-menu";
import type { FeedItemDTO } from "./types";

/**
 * X-style timeline row (article flavor). Rendered from server pages and from
 * the client-side feed stream alike. Flat: no card border / radius / shadow —
 * rows are separated by 1px borders and tinted on hover. When the viewer is
 * the author, the action strip gains inline edit / delete (recycle bin).
 */

/** 所有时间线（主页流/个人主页/发现/话题/合集）共用的行样式：
 * 1px 分割线（.feed-row）+ 与页面标题等元素对齐的左右 20px 内边距。 */
export const FEED_ROW_CLASS = "feed-row px-5 py-2.5";

/** 浏览次数展示：1.2w 形式的紧凑数字。 */
export function formatViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/.0$/, "")}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/.0$/, "")}k`;
  return String(n);
}

/** The shared timeline row shell: 40px avatar + content column.
 * With `href`, the whole row navigates to the post detail on click/Enter —
 * clicks on real links/buttons inside keep their own behavior. */
export function TimelineRow({
  author,
  children,
  className,
  href,
}: {
  author: FeedItemDTO["author"];
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const router = useRouter();
  const interactive = Boolean(href);

  function activate(e: React.MouseEvent | React.KeyboardEvent) {
    if (!href) return;
    if (e.target instanceof HTMLElement && e.target.closest("a,button,input,textarea,[role='button']")) return;
    router.push(href);
  }

  return (
    <article
      className={cn(
        "relative flex gap-3 rounded-lg px-2.5 py-3 transition-colors hover:bg-[var(--hover,#f7f8f8)]",
        interactive && "cursor-pointer",
        className,
      )}
      onClick={interactive ? (e) => activate(e) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" && !(e.target instanceof HTMLElement && e.target.closest("a,button"))) activate(e);
            }
          : undefined
      }
      role={interactive ? "link" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <Link href={routes.profile(author.username)} className="shrink-0" aria-label={author.displayName} prefetch={false}>
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

/** Bold name + @username + · relative time + visibility chip.
 * `showLabel=false` hides the content-annotation chip (原创/转载…) — the
 * home/following feeds keep the timeline clean; profiles still show it. */
export function TimelineAuthorLine({
  post,
  author,
  href,
  showLabel = true,
}: {
  post?: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  href?: string;
  showLabel?: boolean;
}) {
  const date = post?.publishedAt ? new Date(post.publishedAt) : null;
  return (
    <div className="flex min-w-0 items-center gap-1 text-[15px] leading-tight">
      <Link
        href={routes.profile(author.username)}
        className="truncate font-medium hover:underline"
        prefetch={false}
      >
        {author.displayName}
      </Link>
      <span className="truncate text-muted-foreground">@{author.username}</span>
      {date && (
        <>
          <span className="shrink-0 text-muted-foreground">·</span>
          <Link href={href ?? routes.profile(author.username)} className="shrink-0 text-muted-foreground hover:underline" prefetch={false}>
            <time dateTime={date.toISOString()}>{timeAgo(date, "zh")}</time>
          </Link>
        </>
      )}
      {post?.visibility === "followers" && (
        <Badge variant="secondary" className="ml-1 shrink-0">
          关注者可见
        </Badge>
      )}
      {showLabel && post?.label && (
        <AnnotationBadge
          label={post.label}
          sourceUrl={post.sourceUrl}
          sourceName={post.sourceName}
          size="sm"
          className="ml-0.5 shrink-0"
        />
      )}
    </div>
  );
}

/** Static X-style action strip: comment / like / repost / views.
 * Edit & delete for the author live in the row's「···」menu instead. */
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
        prefetch={false}
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/a:bg-sky-500/10">
          <MessageCircle className="size-4" />
        </span>
        {post.commentCount > 0 && <span className="num tabular-nums">{post.commentCount}</span>}
      </Link>
      <span
        className="group/l inline-flex items-center gap-1 text-xs transition-colors hover:text-rose-500"
        aria-label="喜欢"
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/l:bg-rose-500/10">
          <Heart className="size-4" />
        </span>
        {post.likeCount > 0 && <span className="num tabular-nums">{post.likeCount}</span>}
      </span>
      <span
        className="group/r inline-flex items-center gap-1 text-xs transition-colors hover:text-emerald-500"
        aria-label="转推"
      >
        <span className="grid size-7 place-items-center rounded-full transition-colors group-hover/r:bg-emerald-500/10">
          <Repeat2 className="size-4" />
        </span>
        {post.repostCount > 0 && <span className="num tabular-nums">{post.repostCount}</span>}
      </span>
      <span className="group/v inline-flex items-center gap-1 text-xs" aria-label="查看次数" title="查看次数">
        <span className="grid size-7 place-items-center rounded-full">
          <Eye className="size-4" />
        </span>
        {post.views > 0 && <span className="num tabular-nums">{formatViews(post.views)}</span>}
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
  viewerUsername,
  showLabel = true,
  rowHref = false,
  menu = false,
}: {
  post: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  /** kept for API compat; "grid" renders a full-width cover, "list" a side thumbnail */
  variant?: "grid" | "list";
  showAuthor?: boolean;
  className?: string;
  /** render the pinned「代表作」label above the row content */
  pinned?: boolean;
  /** signed-in viewer — enables the inline edit / delete entries when author */
  viewerUsername?: string;
  /** hide the content-annotation chip (home/following feeds) */
  showLabel?: boolean;
  /** whole row navigates to the detail page on click (X-style) */
  rowHref?: boolean;
  /** render the「···」quick-actions menu (home/following feeds) */
  menu?: boolean;
}) {
  const href = postHref(post);
  const cover = post.coverPath ? routes.media(post.coverPath) : null;
  const thumb = variant === "list" && cover;
  const mine = viewerUsername === author.username;

  return (
    <TimelineRow author={author} className={className} href={rowHref ? href : undefined}>
      {menu && (
        <div className="absolute right-2 top-2">
          <RowActionsMenu post={post} author={author} href={href} mine={mine} />
        </div>
      )}
      {pinned && (
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Pin className="size-3.5" /> 代表作
        </p>
      )}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          {showAuthor && (
            <TimelineAuthorLine post={post} author={author} href={href} showLabel={showLabel} />
          )}
          <h3 className="reading-serif mt-0.5 text-base font-normal leading-snug">
            <Link href={href} className="line-clamp-2 hover:underline" prefetch={false}>
              {post.title ?? post.summary?.slice(0, 40) ?? "无题"}
            </Link>
          </h3>
          {post.summary && (
            <p className="reading-serif mt-0.5 line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">
              {post.summary}
            </p>
          )}
        </div>
        {thumb && (
          <Link
            href={href}
            tabIndex={-1}
            aria-hidden
            prefetch={false}
            className="hidden size-24 shrink-0 overflow-hidden rounded-lg bg-[var(--muted)] sm:block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover ?? ""} alt="" loading="lazy" className="size-full object-cover" />
          </Link>
        )}
      </div>
      {cover && !thumb && (
        <Link href={href} tabIndex={-1} aria-hidden prefetch={false} className="mt-2 block overflow-hidden rounded-lg bg-[var(--muted)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" loading="lazy" className="aspect-[2/1] w-full object-cover" />
        </Link>
      )}
      <TimelineActions post={post} href={href} />
    </TimelineRow>
  );
}
