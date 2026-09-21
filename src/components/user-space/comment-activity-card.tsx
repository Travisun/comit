"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Lock, MessageCircle } from "lucide-react";
import { routes } from "@/core/routes";
import { timeAgo, truncate } from "@/lib/utils";
import { InlineText } from "@/components/social/inline-text";
import { TimelineRow } from "./article-card";
import { CommentMenu } from "@/components/social/comment-menu";
import type { CommentActivityRow, UserBrief } from "./types";

/**
 * 「动态」时间线里的评论行：作者线 + 「评论了《来源帖》/ 回复了 @xx」
 * 上下文 + 评论正文摘录 + 前往原帖楼层的链接。整行点击即跳转
 * `/post/{publicId}#comment-{id}`（楼层锚点由评论区 focusAnchor 处理）。
 * manage=true（本人视角）时右上角挂「···」菜单：可见性切换 / 删除。
 */

/** 轻量 markdown 归一：图片/代码/引用/强调语法去掉，链接语法保留给 InlineText
 *  成链（正文已由 DAL 出口展开 @提及，先截断会把链接语法切半截）。 */
function flattenMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, " ") // 代码块/行内代码
    .replace(/^>\s?/gm, "") // 引用符
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // 加粗/斜体/删除线
    .replace(/^#{1,6}\s+/gm, "") // 标题符
    .replace(/\s+/g, " ")
    .trim();
}

/** 来源帖摘要（库里已是纯文本摘要）：无链接语法，直接截断即可 */
function excerpt(md: string, max: number): string {
  return truncate(flattenMarkdown(md), max);
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
  manage = false,
}: {
  comment: CommentActivityRow;
  author: UserBrief;
  className?: string;
  /** 本人视角：显示右上角管理菜单（可见性 / 删除） */
  manage?: boolean;
}) {
  const router = useRouter();
  const href = `${routes.post(comment.postPublicId)}#comment-${comment.id}`;
  const date = new Date(comment.createdAt);
  const private_ = comment.visibility === "private";

  return (
    <TimelineRow author={author} className={className} href={href}>
      {manage && (
        <div className="absolute right-0 top-0 z-10">
          <CommentMenu
            comment={{ ...comment, mine: true, canDelete: true }}
            onChanged={() => router.refresh()}
          />
        </div>
      )}
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
        {private_ && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Lock className="size-2.5" aria-hidden /> 仅自己可见
          </span>
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
        <InlineText text={flattenMarkdown(comment.body)} max={280} />
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
