import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/core/routes";
import { ArticleEditor } from "@/components/editor/article-editor";

/**
 * /write — 长文创作页（独立全页编辑器，非浮层）。完整 Vditor 工具栏 +
 * 发布设置弹层；从 Composer 抽屉「写文章」进入时会带上一已输入的手稿。
 * 短动态走首页的全宽抽屉（/?composer 或「创作」按钮）。
 */
export const metadata: Metadata = { title: "写文章" };

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);

  // legacy /write?type=short — short posts live in the home composer drawer
  const { type } = await searchParams;
  if (type === "short") redirect(routes.home);

  return <ArticleEditor />;
}
