import { notFound } from "next/navigation";
import Link from "next/link";
import { getExtensionPage } from "@/extensions/_boot/registry";
import { PluginErrorBoundary } from "@/lib/plugins/error-boundary";

/**
 * /e/[...slug] — 扩展独立页面统一入口。
 * 页面由扩展注册（extensions/_boot/registry.ts），layout: "site" 含三栏壳，
 * "bare" 全屏（SiteShell 按 pathname 匹配后跳过站点壳）。
 * 扩展页面整体包裹错误边界:扩展自身抛错只降级本页卡片并上报,
 * 不产生全站错误页。
 */
export default async function ExtensionPageRoute({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const path = (slug ?? []).join("/");
  const def = getExtensionPage(path);
  if (!def) throw notFound();
  const Page = def.component;
  return (
    <PluginErrorBoundary
      scope={`page:${path}`}
      fallback={
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-semibold">{def.title} 暂时无法显示</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            扩展页面发生错误,已上报;其余功能不受影响。
          </p>
          <Link
            href="/"
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            返回首页
          </Link>
        </div>
      }
    >
      <Page />
    </PluginErrorBoundary>
  );
}
