import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

/**
 * 用户（博主）可控 HTML 属性收口 —— rehype transform（sanitize 之后执行）：
 * markdown 管线（lib/markdown/server.ts，raw HTML 经 schema 放行 target/rel/class）
 * 与扩展注入管线（core/capabilities/post-render.ts，第三方过滤器输出）都存在
 * 用户可控的任意 target/rel 值与任意 class 名，这里统一收紧：
 *
 * 1. target：仅允许 "_blank"/"_self"（浏览器保留窗口名），其余一律删除 —
 *    任意值（如命名窗口/父窗口框架名）可用于框架劫持与打开非预期上下文；
 * 2. rel：按空格分词 → 与白名单取交集（大小写归一为小写、去重），非法词剔除；
 *    最终 target 仍为 _blank 时强制含 noopener（封堵 reverse tabnabbing）；
 * 3. class：单个 class 必须匹配 /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/（字母开头、
 *    总长 ≤64、仅字母数字/-/_），防选择器注入（`{` `}` `[` `*` `:` 等）与
 *    CSS 侧信道（超长 token 外带数据）；单元素数量上限 MAX_CLASSES_PER_ELEMENT，
 *    不合规/超额直接丢弃（截断保留前 N 个，而非整体清空，避免误伤正常排版）。
 *
 * 必须挂在 sanitize 之后、KaTeX/pretty-code/mermaid/external-guard 等可信
 * transform 之前：只收紧用户可控产物，可信管线随后注入的 class/style 不受影响。
 */

/** target 白名单（浏览器保留窗口名，仅这两个语义安全） */
const ALLOWED_TARGETS = new Set(["_blank", "_self"]);

/** rel 分词白名单（小写存储；大小写不敏感匹配） */
const ALLOWED_REL_TOKENS = new Set([
  "noopener",
  "noreferrer",
  "nofollow",
  "external",
  "author",
  "license",
  "alternate",
  "bookmark",
  "help",
  "next",
  "prev",
  "tag",
  "me",
]);

/** class 名单字规则：字母开头 + [a-zA-Z0-9_-]，总长 1..64 */
export const CLASS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
/** 单元素 class 总量上限（防 class 堆砌外带/选择器侧信道） */
export const MAX_CLASSES_PER_ELEMENT = 20;

/** 任意属性值（string / string[] / 其他）→ 分词数组（非法类型与空串剔除） */
function tokensOf(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "");
}

/** target 收口：仅 _blank/_self，否则返回 null（调用方删除属性） */
export function guardTargetValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return ALLOWED_TARGETS.has(v) ? v : null;
}

/** rel 收口：分词 → 白名单交集（归一小写 + 去重） */
export function guardRelTokens(value: unknown): string[] {
  const out: string[] = [];
  for (const t of tokensOf(value)) {
    const tok = t.trim().toLowerCase();
    if (ALLOWED_REL_TOKENS.has(tok) && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/** class 收口：分词 → 正则合规 + 去重 + 总量截断 */
export function guardClassTokens(value: unknown): string[] {
  const out: string[] = [];
  for (const t of tokensOf(value)) {
    const c = t.trim();
    if (!CLASS_NAME_RE.test(c) || out.includes(c)) continue;
    if (out.length >= MAX_CLASSES_PER_ELEMENT) break;
    out.push(c);
  }
  return out;
}

export function rehypeGuardAttributes() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const props = node.properties;
      if (!props) return;

      // class：hast 规范化后在 className（数组）；防御性兼容原始 "class" 键，
      // 两路合并后统一收口，输出仅保留规范化的 className。
      const classInput = [...tokensOf(props.className), ...tokensOf(props.class)];
      if (props.class !== undefined) delete props.class;
      if (props.className !== undefined || classInput.length > 0) {
        const cls = guardClassTokens(classInput);
        if (cls.length) props.className = cls;
        else delete props.className;
      }

      if (props.target !== undefined) {
        const t = guardTargetValue(props.target);
        if (t) props.target = t;
        else delete props.target;
      }

      if (node.tagName === "a" || props.rel !== undefined) {
        const rel = guardRelTokens(props.rel);
        // _blank 恒含 noopener（无论 target 是用户写的还是这里保留的）
        if (props.target === "_blank" && !rel.includes("noopener")) rel.push("noopener");
        if (rel.length) props.rel = rel;
        else delete props.rel;
      }
    });
  };
}
