import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";

/**
 * (dashboard) 段级流式骨架 — 控制台形态：页头 + 统计卡网格 + 表格卡片，
 * 与 admin 概览页加载态一致（见 admin/page.tsx 的 Skeleton 分支）。
 * 有了该边界，导航立刻呈现骨架、内容由 RSC 流式填充，缩短在途请求窗口。
 */
export default function DashboardLoading() {
  return (
    <div aria-hidden>
      {/* 页头（PageHeader 形态） */}
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="space-y-5">
        {/* stat cards */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-2 h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        {/* table card */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
