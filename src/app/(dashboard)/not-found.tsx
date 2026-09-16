import Link from "next/link";
import { Compass, House } from "lucide-react";

/**
 * (dashboard) 段内 404 — 控制台风格简洁页。
 * 控制台路由不进搜索引擎索引，无需 SEO 元数据；给「回首页 / 去前台」出口即可。
 */
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-5xl font-black tracking-tight">404</p>
      <p className="text-sm font-semibold text-foreground">页面不存在 / Page not found</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        控制台下没有这个地址，可能已被移动或移除。
      </p>
      <div className="mt-4 flex gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <House className="size-3.5" aria-hidden />
          返回首页
        </Link>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--hover)]"
        >
          <Compass className="size-3.5" aria-hidden />
          控制台首页
        </Link>
      </div>
    </div>
  );
}
