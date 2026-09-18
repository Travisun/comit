import Link from "next/link";
import { Heart, MessageCircle } from "lucide-react";
import { routes } from "@/core/routes";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { TimelineRow } from "./article-card";
import type { CommentActivityRow } from "./queries";
import type { UserBrief } from "./types";

/**
 * 「动态」时间线里的评论行：作者线 + 「评论了《来源帖》/ 回复了 @xx」
 * 上下文 + 评论正文摘录 + 前往原帖楼层的链接。整行点击即跳转
 * `/post/{publicId}#comment-{id}`（楼层锚点由评论区 focusAnchor 处理）。
 */

/** 轻量 markdown 摘录：去掉图片/链接语法，保留可读文本 */
function excerpt(md: string, max = 280): string {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文本
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, " ") // 代码块/行内代码
    .replace(/^>\s?/gm, "") // 引用符
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // 加粗/斜体/删除线
    .replace(/^#{1,6}\s+/gm, "") // 标题符
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sourceLabel(c: CommentActivityRow): string {
  if (c.postType === "short" && !c.postTitle) {
    return c.postSummary ? excerpt(c.postSummary, 60) : "一条动态";
  }
  return c.postTitle ?? "一条动态";
}

export function CommentActivityCard({
  comment,
  author,
  className,
}: {
  comment: CommentActivityRow;
  author: UserBrief;
  className?: string;
}) {
  const href = `${routes.post(comment.postPublicId)}#comment-${comment.id}`;
  const date = new Date(comment.createdAt);
  const pending = comment.status === "pending_review";
  const rejected = comment.status === "rejected";

  return (
    <TimelineRow author={author} className={className} href={href}>
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-[15px] leading-tight">
        <Link
          href={routes.profile(author.username)}
          className="truncate font-medium hover:underline"
          prefetch={false}
        >
          {author.displayName}
        </Link>
        <span className="truncate text-muted-foreground">@{author.username}</span>
        <span className="text-muted-foreground">·</span>
        <time dateTime={date.toISOString()} className="text-muted-foreground">
          {timeAgo(date, "zh")}
        </time>
        {pending && (
          <Badge variant="secondary" className="ml-0.5 shrink-0">
            审核中
          </Badge>
        )}
        {rejected && (
          <Badge variant="destructive" className="ml-0.5 shrink-0">
            未通过审核
          </Badge>
        )}
      </div>

      {/* 上下文行：评论了哪篇帖子 / 回复了谁 */}
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <span className="shrink-0">{comment.replyToUsername ? "回复了" : "评论了"}</span>
        {comment.replyToUsername && (
          <Link
            href={routes.profile(comment.replyToUsername)}
            className="shrink-0 font-medium text-foreground hover:underline"
            prefetch={false}
          >
            @{comment.replyToUsername}
          </Link>
        )}
        <span className="shrink-0">{comment.replyToUsername ? "的评论 ·" : ""}</span>
        <Link href={href} className="truncate font-medium text-foreground hover:underline" prefetch={false}>
          {sourceLabel(comment)}
        </Link>
      </div>

      <p className="reading-serif mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
        {excerpt(comment.body)}
      </p>

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1" aria-label="评论获得的喜欢">
          <Heart className="size-3.5" />
          {comment.likeCount > 0 && <span className="num tabular-nums">{comment.likeCount}</span>}
        </span>
        <a href={href} className="inline-flex items-center gap-1 transition-colors hover:text-sky-500">
          <MessageCircle className="size-3.5" />
          前往楼层
        </a>
      </div>
    </TimelineRow>
  );
}
