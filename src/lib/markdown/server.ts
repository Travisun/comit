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
import { hooks } from "@/core/hooks";

/**
 * Server-side Markdown → HTML pipeline.
 *
 * remark-parse → gfm → math → hast → raw HTML (trusted set, sanitized hard)
 * → sanitize (XSS/iframe-proof) → KaTeX → Shiki code highlight → mermaid
 * block marker → external-link guard (nofollow + target=_blank) → string.
 *
 * Mermaid blocks (```mermaid …```) are emitted as <div class="mermaid-block">
 * with base64-encoded source; the client component renders SVG in the browser.
 */

/** Drop dangerous elements entirely (children included) before sanitizing. */
function rehypeDropDangerous() {
  const DROP = new Set(["script", "style", "iframe", "object", "embed", "frame", "frameset", "applet", "base", "form", "input", "button", "select", "textarea", "link", "meta", "noscript"]);
  return (tree: Root) => {
    visit(tree, "parent", (node: Element) => {
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
    src: ["http", "https", "data"],
    href: ["http", "https", "mailto", "#", "/"],
  },
  strip: [],
};

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
  // extension point: plugins may post-filter rendered HTML
  const ctx = { html };
  await hooks.callHook("post:render", ctx as never);
  html = ctx.html;
  return { html, headings };
}
