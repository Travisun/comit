import {
  TimelineActions,
  TimelineAuthorLine,
  TimelineRow,
} from "./article-card";
import { postHref } from "./post-href";
import { RowActionsMenu } from "./row-actions-menu";
import { FeedRowAfterSlot } from "@/extensions/_boot/client";
import { Badge } from "@/components/ui/primitives";
import { InlineText } from "@/components/social/inline-text";
import type { FeedItemDTO } from "./types";

/**
 * Short-post ("动态") timeline row: author line + full text (markdown stripped
 * to paragraphs) + inline image thumbnails + action strip. Flat row style —
 * 1px bottom border, hover tint, no card chrome.
 *
 * 正文由 DAL 出口展开过 @提及（`[@昵称](/u/用户名)`），故必须经 InlineText 成链：
 * 直接当文本渲染会把链接语法漏给用户。
 */

function extractImages(md: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = md.replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (_m, src: string) => {
    images.push(src);
    return " ";
  });
  return { text, images };
}

function ShortBody({ content }: { content: string }) {
  const { text, images } = extractImages(content);
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <div className="reading-serif space-y-2 text-[15px] leading-relaxed">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap break-words">
          <InlineText text={p} />
        </p>
      ))}
      {images.length > 0 && (
        <div className={cnImages(images.length)}>
          {images.slice(0, 4).map((src, i) => (
            <a
              key={i}
              href={src}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg bg-[var(--muted)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="size-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function cnImages(n: number): string {
  if (n === 1) return "mt-2 grid max-w-sm overflow-hidden rounded-lg";
  if (n === 2 || n === 4) return "mt-2 grid grid-cols-2 gap-1.5 max-w-md";
  return "mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 max-w-lg";
}

export function ShortCard({
  post,
  author,
  className,
  viewerUsername,
  showLabel = true,
  rowHref = false,
  menu = false,
  badge,
}: {
  post: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  className?: string;
  /** signed-in viewer — enables the inline edit / delete entries when author */
  viewerUsername?: string;
  /** hide the content-annotation chip (home/following feeds) */
  showLabel?: boolean;
  /** whole row navigates to the detail page on click (X-style) */
  rowHref?: boolean;
  /** render the「···」quick-actions menu (home/following feeds) */
  menu?: boolean;
  /** 附带状态徽标（如本人视角的「仅自己可见」隐私标记） */
  badge?: { text: string; tone?: "default" | "destructive" };
}) {
  const href = postHref(post);
  const { text } = extractImages(post.content || post.summary || " ");
  const needsSummaryLink = text.trim().length > 280;

  return (
    <TimelineRow author={author} className={className} href={rowHref ? href : undefined}>
      {menu && (
        <div className="absolute right-2 top-2">
          <RowActionsMenu post={post} author={author} href={href} mine={viewerUsername === author.username} />
        </div>
      )}
      <TimelineAuthorLine post={post} author={author} href={href} showLabel={showLabel} />
      {badge && (
        <Badge variant={badge.tone === "destructive" ? "destructive" : "secondary"} className="mt-0.5">
          {badge.text}
        </Badge>
      )}
      {post.title && (
        <h3 className="reading-serif mt-0.5 text-base font-normal leading-snug">
          <span className="line-clamp-2">{post.title}</span>
        </h3>
      )}
      {post.content && (
        <div className="mt-0.5">
          <ShortBody content={post.content || post.summary || " "} />
        </div>
      )}
      <FeedRowAfterSlot postId={post.id} hasPoll={Boolean(post.hasPoll)} />
      {needsSummaryLink && (
        <a href={href} className="mt-1 inline-block text-sm text-sky-500 hover:underline">
          显示更多
        </a>
      )}
      <TimelineActions post={post} href={href} signedIn={Boolean(viewerUsername)} />
    </TimelineRow>
  );
}
