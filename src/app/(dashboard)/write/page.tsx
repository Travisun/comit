import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/core/routes";
import { ArticleEditor } from "@/components/editor/article-editor";
import { ShortPostEditor } from "@/components/editor/short-post-editor";

/**
 * /write — new article editor, or the short-post composer with ?type=short.
 */
export const metadata: Metadata = { title: "写文章" };

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);
  const { type } = await searchParams;
  if (type === "short") return <ShortPostEditor />;
  return <ArticleEditor />;
}
