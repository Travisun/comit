"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { InlineText } from "@/components/social/inline-text";
import { apiGet, mediaUrl } from "@/lib/client/api";
import { findCommentEl } from "@/lib/client/comment-anchor";
import { queryKeys } from "@/lib/query/keys";
import { commentsPageSchema } from "@/lib/models/comments";

/**
 * 解决方案摘要盒（Discourse Solve 式，可多个）：渲染在帖子主内容区尾部
 * （正文与评论区之间）。每行列出 解决方案评论作者（头像 + 名称）+ 评论
 * 摘要，点击跳转到对应楼层锚点（#comment-{id}，由评论区 focusAnchor 定位）。
 */

/** 评论体归一为摘要文本：去图片与多余空白；链接语法（含 @提及展开态）保留，
 *  由 InlineText 成链 —— 先截断后拉平会把 `[@x](/u/` 半截漏成字面量，故长度
 *  裁剪交给 InlineText 的按段截断。 */
function excerpt(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function SolutionsBox({ postId, disabled }: { postId: string; disabled?: boolean }) {
  const solutionsQ = useQuery({
    queryKey: queryKeys.commentsSolutions(postId),
    queryFn: async () =>
      commentsPageSchema.parse(
        await apiGet<unknown>(`/api/comments?postId=${postId}&list=solutions&limit=20`),
      ),
    enabled: !disabled,
    staleTime: 15_000,
  });

  const items = solutionsQ.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <BadgeCheck className="size-3.5" aria-hidden />
        解决方案 · {items.length}
      </div>
      <div className="space-y-1">
        {items.map((sc) => (
          // role=button 而非 <button>：摘要里可能内嵌 @提及链接，button 的
          // 内容模型不允许交互后代（与时间线行 TimelineRow 同一处理方式）
          <div
            key={sc.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              // 行内 @提及链接的点击不该再触发楼层跳转（同 TimelineRow 的守卫）
              const target = e.target instanceof Element ? e.target : null;
              if (target?.closest("a,button,input")) return;
              // 抗 DOM-clobbering：data-comment-id 属性选择器替代全局 getElementById
              const el = findCommentEl(sc.id);
              if (el) {
                el.scrollIntoView({ block: "center", behavior: "smooth" });
                history.replaceState(null, "", `#comment-${sc.id}`);
              } else {
                toast.info("该评论在列表后段，请向下翻页查看");
              }
            }}
            onKeyDown={(e) => {
              const target = e.target instanceof Element ? e.target : null;
              if (e.key === "Enter" && !target?.closest("a,button,input")) e.currentTarget.click();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover)]"
          >
            <Avatar className="size-6 shrink-0 border border-border">
              {sc.user.avatarPath && (
                <AvatarImage src={mediaUrl(sc.user.avatarPath)} alt={sc.user.displayName} />
              )}
              <AvatarFallback>{sc.user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
              <span className="font-medium">{sc.user.displayName}</span>
              <span className="text-muted-foreground">
                ：<InlineText text={excerpt(sc.body)} max={80} />
              </span>
            </span>
            <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}
