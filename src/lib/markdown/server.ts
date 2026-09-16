import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import rehypePrettyCode from "rehype-pretty-code";
import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import { config } from "@/core/config";
import { callHook } from "@/core/hooks";

/**
 * Server-side Markdown → HTML pipeline.
 *
 * remark-parse → gfm → math → hast → raw HTML (trusted set, sanitized hard)
 * → sanitize (XSS/iframe-proof) → style 收紧（pre/code 内保留更宽的低危白名单、
 * 但值层面高危声明同样剥除，见 rehypeTightenStyles）→ KaTeX → Shiki code
 * highlight → mermaid
 * block marker → external-link guard (nofollow + target=_blank) → string.
 *
 * Mermaid blocks (```mermaid …```) are emitted as <div class="mermaid-block">
 * with base64-encoded source; the client component renders SVG in the browser.
 */

/** Drop dangerous elements entirely (children included) before sanitizing. */
function rehypeDropDangerous() {
  const DROP = new Set(["script", "style", "iframe", "object", "embed", "frame", "frameset", "applet", "base", "form", "input", "button", "select", "textarea", "link", "meta", "noscript"]);
  return (tree: Root) => {
    // 无 test 的 visit 遍历全部节点；只对含 children 的父节点过滤危险子元素。
    // （此前误用 "parent" 作为 unist test —— 它不是合法测试，命中 0 节点，
    // 本函数实际从未生效，危险元素全靠 rehype-sanitize 兜底。）
    visit(tree, (node) => {
      if (!("children" in node) || !Array.isArray(node.children)) return;
      node.children = (node.children as Element[]).filter(
        (c) => !(c.type === "element" && typeof c.tagName === "string" && DROP.has(c.tagName)),
      );
    });
  };
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "figure",
    "figcaption",
    "abbr",
    "kbd",
    "mark",
    "bdi",
    "bdo",
    "ins",
    "sub",
    "sup",
    "div",
    "span",
    "video",
    "source",
    "math",
    "semantics",
    "annotation",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "class",
      "id",
      "dataExternal",
      "dataExternalHref",
      "dataAlign",
      "style",
    ],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding", "style"],
    video: ["src", "poster", "controls", "width", "height", "preload"],
    source: ["src", "type"],
    span: [...(defaultSchema.attributes?.span ?? []), "style"],
    div: [...(defaultSchema.attributes?.div ?? []), "style"],
    th: ["style", "align"],
    td: ["style", "align"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // img/video/source src 只放行 http(s)。data: 已移除 —— 调查结论：管线内
    // 无任何 data: URI 图片生产者（mermaid 是客户端渲染占位符 <div class=
    // "mermaid-block" data-diagram=base64>，见 rehypeMermaidBlocks；KaTeX html
    // 输出走 span+CSS 字体；shiki 输出 span）。保留 data: 反而给像素追踪
    // （1x1 data: img 外带请求）和内容伪装留口子。
    src: ["http", "https"],
    href: ["http", "https", "mailto", "#", "/"],
  },
  strip: [],
};

/**
 * Style 收紧（在 sanitize 之后、KaTeX/Shiki 之前执行）：
 *
 * sanitize 层仍放行 style 属性（不能全局删 —— rehype-pretty-code/shiki 的行内
 * 高亮依赖 style，且它在 sanitize 之后才注入，见下方管线顺序），这里做二次收紧：
 * - <pre>/<code> 子树：低危属性放行范围更宽（shiki 高亮与用户自定义代码块配色
 *   需要；prettyCode 在本 transform 之后运行本就不受影响，宽口径是防御管线
 *   顺序变化，也保住用户手写的代码块内联样式），但**并非完全豁免** —— 值层面
 *   的高危声明（url()/expression()/覆盖式定位/视口单位）同样剥除，否则 raw
 *   HTML 可借 <pre><span style="position:fixed…"> 做全屏覆盖钓鱼或
 *   background:url() 像素追踪；
 * - 其余元素的 style 仅保留安全声明子集：color / background-color /
 *   font-weight / font-style。
 *
 * 攻击面（attack surface）：position:fixed/absolute 等覆盖式钓鱼（浮层冒充
 * 站点 UI 诱导输入/点击）、background-image:url() 像素追踪与访客 IP 外泄。
 * 白名单属性本身无法携带 url()，值层面再做 url(/expression() 双保险过滤。
 */
const SAFE_STYLE_PROPS = new Set(["color", "background-color", "font-weight", "font-style"]);

/**
 * 任何上下文（含 pre/code 子树）都禁止的覆盖式声明属性：全屏定位、位移、
 * 尺寸类 —— 是覆盖钓鱼（overlay phishing）的最小工具集。shiki 高亮所需的
 * color/background-color/display/--shiki-* 等均不在列，不受影响。
 */
const DANGEROUS_STYLE_PROPS = new Set([
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "z-index",
  "transform",
  "translate",
  "rotate",
  "scale",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
]);

/** 值层面高危模式：url()/expression()（外带请求/旧 IE 脚本）与 vh/vw 等
 *  视口单位（配合尺寸类属性可撑满全屏）。要求数字前缀避免误伤字体名等。 */
const DANGEROUS_STYLE_VALUE = /url\s*\(|expression\s*\(|\d(?:\.\d+)?\s*(?:vh|vw|vmin|vmax)\b/i;

export function rehypeTightenStyles() {
  // 严格白名单（pre/code 之外）：仅保留颜色/字重子集
  const strictStyle = (style: string): string =>
    style
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => {
        const i = decl.indexOf(":");
        if (i <= 0) return false;
        // 双保险：即使白名单误放行，含 url()/expression() 的声明一律丢弃
        if (/url\s*\(|expression\s*\(/i.test(decl)) return false;
        return SAFE_STYLE_PROPS.has(decl.slice(0, i).trim().toLowerCase());
      })
      .join("; ");
  // pre/code 子树：属性白名单放宽（保留 --shiki-* 自定义属性、display 等
  // 低危声明），但高危属性与高危值一律剥除 —— 内外差别只是"低危放行更宽"
  const codeStyle = (style: string): string =>
    style
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => {
        const i = decl.indexOf(":");
        if (i <= 0) return false;
        const prop = decl.slice(0, i).trim().toLowerCase();
        if (prop.startsWith("--")) return true; // CSS 自定义属性（如 shiki 的 --shiki-*）
        if (DANGEROUS_STYLE_PROPS.has(prop)) return false;
        if (DANGEROUS_STYLE_VALUE.test(decl)) return false;
        return true;
      })
      .join("; ");
  return (tree: Root) => {
    // 先标记 <pre>/<code> 子树（含自身）—— 走更宽的 codeStyle，而非完全豁免
    const inCode = new WeakSet<Element>();
    visit(tree, "element", (node) => {
      if (node.tagName !== "pre" && node.tagName !== "code") return;
      visit(node, "element", (desc) => {
        inCode.add(desc);
      });
    });
    visit(tree, "element", (node) => {
      const style = node.properties?.style;
      if (typeof style !== "string" || !style) return;
      const next = (inCode.has(node) ? codeStyle : strictStyle)(style);
      if (next) node.properties.style = next;
      else delete node.properties.style;
    });
  };
}

function rehypeMermaidBlocks() {
  const prop = (el: Element, a: string, b: string): unknown =>
    el.properties?.[a] ?? el.properties?.[b];
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || index === undefined) return;
      // rehype-pretty-code output: <figure data-rehype-pretty-code-figure>
      //   <pre><code data-language="mermaid">…</code></pre></figure>
      if (node.tagName === "figure" && prop(node, "data-rehype-pretty-code-figure", "dataRehypePrettyCodeFigure") !== undefined) {
        const pre = node.children.find((c) => c.type === "element" && (c as Element).tagName === "pre") as Element | undefined;
        const code = pre?.children.find((c) => c.type === "element" && (c as Element).tagName === "code") as Element | undefined;
        const lang = code ? String(prop(code, "data-language", "dataLanguage") ?? "") : "";
        if (lang === "mermaid" && code) {
          const div: Element = {
            type: "element",
            tagName: "div",
            properties: {
              className: ["mermaid-block"],
              dataDiagram: Buffer.from(textContentOf(code), "utf8").toString("base64"),
            },
            children: [],
          };
          parent.children[index] = div;
        }
        return;
      }
      // fallback: bare <code class="language-mermaid"> without a figure wrapper
      const cls = (node.properties?.className as string[]) ?? [];
      const lang =
        String(prop(node, "data-language", "dataLanguage") ?? "") ||
        (cls.find((c) => c.startsWith("language-"))?.slice(9) ?? "");
      if (node.tagName === "code" && lang === "mermaid") {
        const text = textContentOf(node);
        const div: Element = {
          type: "element",
          tagName: "div",
          properties: {
            className: ["mermaid-block"],
            dataDiagram: Buffer.from(text, "utf8").toString("base64"),
          },
          children: [],
        };
        const pre = parent.children[index - 1];
        if (pre && pre.type === "element" && pre.tagName === "pre") {
          parent.children.splice(index - 1, 2, div);
        } else {
          parent.children[index] = div;
        }
      }
    });
  };
}

function textContentOf(node: Element): string {
  let out = "";
  const walk = (children: Element["children"]) => {
    for (const child of children) {
      if (child.type === "text") out += String(child.value ?? "");
      else if (child.type === "element") walk(child.children);
    }
  };
  walk(node.children);
  return out;
}

/** nofollow + new-tab + leave-site confirmation for external links. */
function rehypeExternalGuard() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = String(node.properties?.href ?? "");
      if (!/^https?:\/\//i.test(href)) return;
      let external = true;
      try {
        external = new URL(href).host !== new URL(config.app.url).host;
      } catch {
        /* keep external=true */
      }
      if (!external) return;
      node.properties = {
        ...node.properties,
        target: "_blank",
        rel: ["nofollow", "noopener", "noreferrer"],
        dataExternal: "",
        dataExternalHref: href,
      };
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeDropDangerous)
  .use(rehypeSanitize, sanitizeSchema as never)
  .use(rehypeTightenStyles)
  .use(rehypeKatex, { output: "html", strict: false, trust: false })
  .use(rehypePrettyCode, {
    theme: { dark: "github-dark-dimmed", light: "github-light" },
    keepBackground: true,
    defaultLang: "plaintext",
  })
  .use(rehypeMermaidBlocks)
  .use(rehypeExternalGuard)
  .use(rehypeStringify);

export interface RenderResult {
  html: string;
  headings: { id: string; text: string; level: number }[];
}

export async function renderMarkdown(md: string): Promise<RenderResult> {
  const headings: RenderResult["headings"] = [];
  // heading ids for TOC/anchor links
  const slugCounts = new Map<string, number>();
  const extract = () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName?.match(/^h[2-4]$/)) {
        const text = textContentOf(node).trim();
        let id = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").slice(0, 64);
        const n = slugCounts.get(id) ?? 0;
        slugCounts.set(id, n + 1);
        if (n > 0) id = `${id}-${n}`;
        node.properties = { ...node.properties, id };
        if (text) headings.push({ id, text, level: Number(node.tagName[1]) });
      }
    });
  };

  const file = await processor()
    .use(extract)
    .process(md);
  let html = String(file);
  // extension point: plugins may post-filter rendered HTML（原地改写 ctx.html）
  const ctx: { html: string } = { html };
  await callHook("post:render", ctx);
  html = ctx.html;
  return { html, headings };
}
