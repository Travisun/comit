import Link from "next/link";
import { Compass, House } from "lucide-react";
import { routes } from "@/core/routes";

/**
 * (site) 段内 404 — 渲染在 SiteShell 的内容列里（(site)/layout 已提供三栏壳）。
 * 不在此处再包 SiteShell：其 props 契约要求 user/locale/siteName 等必填数据，
 * 无法无参渲染，404 也无需为壳再发查询——独立简洁页即可。
 */
export default function SiteNotFound() {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <p className="text-5xl font-black tracking-tight">404</p>
      <p className="text-sm font-semibold text-foreground">页面不存在 / Page not found</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        你访问的内容可能已被删除、移动，或从未存在。
      </p>
      <div className="mt-4 flex gap-2">
        <Link
          href={routes.home}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <House className="size-3.5" aria-hidden />
          返回首页
        </Link>
        <Link
          href={routes.explore}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--hover)]"
        >
          <Compass className="size-3.5" aria-hidden />
          去发现
        </Link>
      </div>
    </div>
  );
}
