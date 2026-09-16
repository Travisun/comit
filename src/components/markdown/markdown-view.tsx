import { renderMarkdown } from "@/lib/markdown/server";
import { cn } from "@/lib/utils";
import { MarkdownEnhance } from "./markdown-enhance";

/** FNV-1a 32-bit content fingerprint — pure function, safe in RSC, no deps. */
function contentFingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 拼上长度：降低 32 位哈希对长文碰撞导致「假稳定」的概率
  return `${(hash >>> 0).toString(16)}-${input.length}`;
}

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
  // scanKey = 内容指纹：router.refresh() 换入新 HTML 后，enhancer 依赖
  // [scanKey] 重扫描，mermaid / 复制按钮 / 外链确认才会重新挂上。
  return (
    <>
      <div className={cn("article-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />
      <MarkdownEnhance scanKey={contentFingerprint(html)} />
    </>
  );
}
