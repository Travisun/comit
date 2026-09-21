/**
 * 行内 mention / markdown 链接语法的共享底座：纯函数，无 IO、无 JSX、不依赖
 * server-only —— 服务端出口（通知、邮件、后台表格、MCP、导出）与浏览器端出口
 * （时间线卡片、评论摘要）必须用同一份正则消费同一份语法。
 *
 * WHY 单一事实源：生产端（processMentions 写 `@[昵称](mention:uuid)`）与消费端
 * 曾各写一份正则，消费端写成 `\[@…\]` 时永不命中 → UI 直显原始引用语法；而截断
 * 若发生在拉平之前，会把 `[@x](/u/` 半截漏成字面量。故语法只在这里定义一次。
 */

/** 稳定引用语法：`@[昵称](mention:{uuid})`。昵称无字符集校验、可能自带 `]` →
 *  标签用「有界惰性」（上界 200，昵称实际 ≤80）而非 `[^\]]+`：惰性向后长到第一个
 *  真实的 `](mention:<uuid>)` 收尾，既容得下 `]` 又不跨多个 token 过度吞并，
 *  同时把回溯代价锁成线性（否则 `@[` + 超长无收尾文本是 O(n²) 的 ReDoS 面）。 */
const MENTION_SRC = String.raw`@\[(?<mentionLabel>[\s\S]{1,200}?)\]\(mention:(?<mentionId>[0-9a-f-]{36})\)`;

/** 链接/图片 href 白名单：站内绝对路径或 http(s) —— javascript:/data: 等不成链。 */
const HREF_SRC = String.raw`(?:https?:\/\/[^\s)]+|\/[^\s)]*)`;

const LINK_SRC = String.raw`\[(?<linkLabel>[^\]]+)\]\((?<linkHref>${HREF_SRC})\)`;
const IMAGE_SRC = String.raw`!\[(?<imageAlt>[^\]]*)\]\((?<imageSrc>${HREF_SRC})\)`;

// 分支顺序即优先级：图片必须先于链接（否则链接分支会吃掉 `![a](/i)` 的 `[a](/i)`
// 只剩一个 `!`），稳定引用先于链接（其 href 不在白名单内，但依赖顺序而非白名单）。
const INLINE_TOKEN = new RegExp(`${IMAGE_SRC}|${MENTION_SRC}|${LINK_SRC}`, "g");

/** 展开后的提及链接：`[@昵称](/用户名)`（expandMentionTokens 的产物形态，
 *  canonical 主页即 /{username}；历史内容里已展开的 `[@昵称](/u/用户名)`
 *  同样命中——/u/ 前缀按旧路径兼容保留）。 */
const MENTION_LINK = /\[@([^\]]+)\]\((?:\/u\/|\/)([A-Za-z0-9_-]+)\)/g;

/** 每次给出新实例：/g 正则有 lastIndex 状态，共享实例会在 test/exec 之间串味。 */
export function mentionTokenRe(): RegExp {
  return new RegExp(MENTION_SRC, "g");
}

export type InlineSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "image"; text: string; src: string };

/** 行内语法 → 文本/链接/图片分段；未展开的稳定引用降级为文本 `@昵称`。 */
export function parseInlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) segments.push({ type: "text", text: text.slice(last, at) });
    last = at + m[0].length;
    const g = m.groups as Record<string, string | undefined>;
    if (g.mentionId !== undefined) segments.push({ type: "text", text: `@${g.mentionLabel ?? ""}` });
    else if (g.imageSrc !== undefined) segments.push({ type: "image", text: g.imageAlt ?? "", src: g.imageSrc });
    else if (g.linkHref !== undefined) segments.push({ type: "link", text: g.linkLabel ?? "", href: g.linkHref });
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

/**
 * 纯文本出口的口径：mention 语法（未展开引用 + 已展开链接两种形态）拉平为可读
 * `@昵称`，其余内容原样保留。无 markdown 渲染器的出口一律经此，否则用户看到的
 * 就是 `@[武林高萝卜](mention:345e…)` 这种引用语法字面量。
 */
export function mentionSyntaxToPlainText(text: string): string {
  return text.replace(mentionTokenRe(), (_whole, label: string) => `@${label}`).replace(MENTION_LINK, "@$1");
}

/** 按可见文本长度截断分段：截点落在段内时切文本，绝不从语法中间切。 */
export function clampInlineSegments(segments: readonly InlineSegment[], max: number): InlineSegment[] {
  const out: InlineSegment[] = [];
  let left = Math.max(max, 0);
  for (const s of segments) {
    if (s.text.length > left) {
      if (left > 0) out.push({ ...s, text: s.text.slice(0, left) });
      out.push({ type: "text", text: "…" });
      return out;
    }
    out.push(s);
    left -= s.text.length;
  }
  return out;
}
