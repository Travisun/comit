import { renderMarkdown } from "@/lib/markdown/server";
import { cn } from "@/lib/utils";
import { MarkdownEnhance } from "./markdown-enhance";

/**
 * Server component: render markdown through the unified pipeline (GFM, KaTeX,
 * Shiki, sanitized raw HTML, mermaid markers, external-link guard) and mount
 * the client-side enhancer (mermaid SVG / leave-site confirm / copy buttons).
 */
export async function MarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const { html } = await renderMarkdown(content);
  return (
    <>
      <div className={cn("article-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownEnhance />
    </>
  );
}
