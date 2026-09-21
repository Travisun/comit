import Link from "next/link";
import { Fragment } from "react";
import { clampInlineSegments, parseInlineSegments, type InlineSegment } from "@/lib/mention-syntax";

/**
 * 短内容行的行内渲染：markdown 链接与 @提及展开态（`[@昵称](/u/用户名)`）成链，
 * 其余保持纯文本；未展开的稳定引用由共享分词降级为 `@昵称`，绝不漏语法字面量。
 *
 * 图片语法不在这里出图：独立图片行由各消费方按自身版式处理（ShortContent 的图片
 * 块、短动态的缩略图栅格），段内残留的图片语法直接丢弃，避免出现半个 `!` + 断链。
 * 纯逻辑在 @/lib/mention-syntax（浏览器侧与服务侧同源）。
 */
export function InlineText({ text, max }: { text: string; max?: number }) {
  const parsed = parseInlineSegments(text);
  const segments = max === undefined ? parsed : clampInlineSegments(parsed, max);
  return (
    <>
      {segments.map((s, i) => (
        <Segment key={i} segment={s} />
      ))}
    </>
  );
}

function Segment({ segment }: { segment: InlineSegment }) {
  if (segment.type === "link") {
    return segment.href.startsWith("/") ? (
      <Link href={segment.href} className="text-link hover:underline">
        {segment.text}
      </Link>
    ) : (
      <a
        href={segment.href}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="text-link hover:underline"
      >
        {segment.text}
      </a>
    );
  }
  if (segment.type === "text") return <Fragment>{segment.text}</Fragment>;
  return null;
}
