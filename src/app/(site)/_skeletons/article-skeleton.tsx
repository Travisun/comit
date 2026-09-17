import { Skeleton } from "@/components/ui/primitives";

/**
 * 详情页（文章 / 短动态）形态骨架 — 与 (site)/loading.tsx 的 ListSkeleton
 * 列表行形态区分，避免详情页导航时先闪列表骨架再跳成文章的错位感。
 * 结构：作者行（头像 + 名字）→ 标题 → 正文段落占位。
 *
 * 宽度对齐真实页面容器（中栏全宽 + px-4 md:px-5，与 post-view / p/[id]
 * 的 <article> 一致），骨架不自设 max-width —— 否则加载骨架与实际内容
 * 宽度错位、加载完成后整页跳动。
 */
export function ArticleSkeleton() {
  return (
    <div className="w-full px-4 pb-12 md:px-5" aria-hidden>
      <div className="space-y-5 pt-2">
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
