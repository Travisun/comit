import { notFound } from "next/navigation";
import { getExtensionPage } from "@/extensions/_boot/registry";

/**
 * /e/[...slug] — 扩展独立页面统一入口。
 * 页面由扩展注册（extensions/_boot/registry.ts），layout: "site" 含三栏壳，
 * "bare" 全屏（SiteShell 按 pathname 匹配后跳过站点壳）。
 */
export default async function ExtensionPageRoute({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const def = getExtensionPage((slug ?? []).join("/"));
  if (!def) throw notFound();
  const Page = def.component;
  return <Page />;
}
