"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { apiGet, mediaUrl } from "@/lib/client/api";
import { findCommentEl } from "@/lib/client/comment-anchor";
import { queryKeys } from "@/lib/query/keys";
import { commentsPageSchema } from "@/lib/models/comments";

/**
 * 解决方案摘要盒（Discourse Solve 式，可多个）：渲染在帖子主内容区尾部
 * （正文与评论区之间）。每行列出 解决方案评论作者（头像 + 名称）+ 评论
 * 摘要，点击跳转到对应楼层锚点（#comment-{id}，由评论区 focusAnchor 定位）。
 */

/** 轻量 markdown 摘录（与评论区摘要口径一致：去图片取前 80 字） */
function excerpt(md: string, max = 80): string {
  const text = md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
          <button
            key={sc.id}
            type="button"
            onClick={() => {
              // 抗 DOM-clobbering：data-comment-id 属性选择器替代全局 getElementById
              const el = findCommentEl(sc.id);
              if (el) {
                el.scrollIntoView({ block: "center", behavior: "smooth" });
                history.replaceState(null, "", `#comment-${sc.id}`);
              } else {
                toast.info("该评论在列表后段，请向下翻页查看");
              }
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
              <span className="text-muted-foreground">：{excerpt(sc.body)}</span>
            </span>
            <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
