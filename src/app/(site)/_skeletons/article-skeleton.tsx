import { Skeleton } from "@/components/ui/primitives";

/**
 * 详情页（文章 / 短动态）形态骨架 — 与 (site)/loading.tsx 的 ListSkeleton
 * 列表行形态区分，避免详情页导航时先闪列表骨架再跳成文章的错位感。
 * 结构：作者行（头像 + 名字）→ 标题 → 正文段落占位。
 */
export function ArticleSkeleton() {
  return (
    <div className="w-full py-8" aria-hidden>
      <div className="mx-auto max-w-2xl space-y-5 px-6">
        {/* author row */}
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        {/* title */}
        <Skeleton className="h-8 w-3/4" />
        {/* paragraphs */}
        <div className="space-y-3 pt-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}
