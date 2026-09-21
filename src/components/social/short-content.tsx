import { cn } from "@/lib/utils";
import { InlineText } from "@/components/social/inline-text";

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

// 图片行仅接受 http(s) 或站内相对路径（非 // 协议相对）：与 markdown 管线
// 的 src scheme 白名单一致，防 data:/其它 scheme 外链追踪
const IMAGE_LINE = /^!\[([^\]]*)\]((?:https?:\/\/\S+|\/(?!\/)\S+))$/;

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
            <InlineText text={b.text} />
          </p>
        ),
      )}
    </div>
  );
}
