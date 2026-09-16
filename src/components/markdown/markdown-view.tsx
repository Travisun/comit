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
  html: htmlOverride,
}: {
  content: string;
  className?: string;
  /** 已渲染的 HTML（扩展管线改写后的产物）— 提供时跳过内部渲染 */
  html?: string;
}) {
  const html = htmlOverride ?? (await renderMarkdown(content)).html;
  return (
    <>
      <div className={cn("article-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownEnhance />
    </>
  );
}
