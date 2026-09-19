import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Deliberately tiny renderer for short-post content: paragraphs, line breaks
 * and standalone images. Full Markdown rendering for articles lives elsewhere;
 * this must not import the editor's markdown pipeline.
 */

interface ImageBlock {
  type: "img";
  src: string;
  alt: string;
}

interface ParagraphBlock {
  type: "p";
  text: string;
}

type Block = ImageBlock | ParagraphBlock;

const IMAGE_LINE = /^!\[([^\]]*)\]\((\S+)\)$/;

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;

/** 段落文本内的 markdown 链接渲染为可点击超链接（其余保持纯文本 + 换行）。 */
function renderLine(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_LINK)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const [, label, href] = m;
    if (href.startsWith("/")) {
      nodes.push(
        <Link key={`${keyBase}-l-${idx}`} href={href} className="text-link hover:underline">
          {label}
        </Link>,
      );
    } else {
      nodes.push(
        <a key={`${keyBase}-l-${idx}`} href={href} target="_blank" rel="nofollow noopener noreferrer" className="text-link hover:underline">
          {label}
        </a>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function parseShortContent(content: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ type: "p", text: para.join("\n") });
      para = [];
    }
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const img = IMAGE_LINE.exec(line);
    if (img) {
      flush();
      blocks.push({ type: "img", alt: img[1], src: img[2] });
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    para.push(raw.trimEnd());
  }
  flush();
  return blocks;
}

export function ShortContent({ content, className }: { content: string; className?: string }) {
  const blocks = parseShortContent(content);
  return (
    <div className={cn("space-y-3 text-[15px] leading-relaxed text-foreground/90", className)}>
      {blocks.map((b, i) =>
        b.type === "img" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={b.src}
            alt={b.alt}
            loading="lazy"
            className="max-h-[32rem] w-full rounded-xl border border-border object-contain"
          />
        ) : (
          <p key={i} className="whitespace-pre-wrap break-words">
            {renderLine(b.text, String(i))}
          </p>
        ),
      )}
    </div>
  );
}
