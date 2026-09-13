import { AnnotationBadge } from "@/components/posts/annotation-badge";
import {
  TimelineActions,
  TimelineAuthorLine,
  TimelineRow,
  postHref,
} from "./article-card";
import type { FeedItemDTO } from "./types";

/**
 * Short-post ("动态") timeline row: author line + full text (markdown stripped
 * to paragraphs) + inline image thumbnails + action strip. Flat row style —
 * 1px bottom border, hover tint, no card chrome.
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
          {p}
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
}: {
  post: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  className?: string;
}) {
  const href = postHref(post, author);
  const { text } = extractImages(post.content || post.summary || " ");
  const needsSummaryLink = text.trim().length > 280;

  return (
    <TimelineRow author={author} className={className}>
      <TimelineAuthorLine post={post} author={author} href={href} />
      {post.label && (
        <div className="mt-1">
          <AnnotationBadge label={post.label} sourceUrl={post.sourceUrl} sourceName={post.sourceName} size="sm" />
        </div>
      )}
      <div className="mt-0.5">
        <ShortBody content={post.content || post.summary || " "} />
      </div>
      {needsSummaryLink && (
        <a href={href} className="mt-1 inline-block text-sm text-sky-500 hover:underline">
          显示更多
        </a>
      )}
      <TimelineActions post={post} href={href} />
    </TimelineRow>
  );
}
