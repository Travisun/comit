import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

/**
 * 扩展注入 HTML（prepend/append）的净化白名单 —— 第三方过滤器的输出
 * 不可信任：script/iframe/事件属性一律剥离，img 限 http(s) 与本站相对路径。
 * 同步管线在 boot 后注册时构建一次。
 */
const sanitizePipeline = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    ...defaultSchema,
    tagNames: (defaultSchema.tagNames ?? []).filter((t) => !["script", "iframe", "object", "embed", "form"].includes(t)),
    attributes: {
      ...defaultSchema.attributes,
      "*": [...(defaultSchema.attributes?.["*"] ?? []), "class", "style"],
      img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height", "loading"],
      a: [...(defaultSchema.attributes?.a ?? []), "href", "target", "rel"],
    },
    protocols: {
      ...defaultSchema.protocols,
      src: ["http", "https"],
      href: ["http", "https", "mailto"],
    },
  })
  .use(rehypeStringify);

export async function sanitizeExtensionHtml(html: string): Promise<string> {
  if (!html.trim()) return "";
  const file = await sanitizePipeline.process({ value: html });
  return String(file);
}

import type { Post, User } from "@/db/schema";

/**
 * 文章渲染管线 — WordPress "the_content" filter 的对应物。
 *
 * 扩展通过 `registerPostRenderFilter` 参与**文章详情**的最终输出：
 *  - `ctx.prepend(html)` / `ctx.append(html)`：正文前/后附加输出（信任 HTML，
 *    仅供内置/可信扩展使用；正文本体在进入管线前已净化）；
 *  - `ctx.html = ...`：整体改写渲染结果（如目录注入、代码增强）；
 *  - `ctx.meta["ext.<id>.*"]`：向客户端槽位下发扩展元数据（随 RSC 序列化）；
 *  - `ctx.interrupt({ code, message?, data? })`：打断渲染（付费墙/登录可见等）
 *    —— 打断后正文不输出，由客户端 `post:interrupt` 槽位按 code 渲染替代 UI。
 *
 * 短动态（/p/[id]）正文由客户端渲染：管线的 prepend/append/meta/interrupt
 * 全部生效，`html` 改写不生效（文档注明）。
 */

export interface PostRenderViewer {
  id: string;
  role: string;
}

export interface PostRenderInterrupt {
  /** 打断原因码，约定 `ext.<id>.<reason>`；客户端按 code 匹配渲染器 */
  code: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface PostRenderContext {
  post: Pick<
    Post,
    "id" | "publicId" | "type" | "title" | "summary" | "content" | "label" | "visibility" | "authorId" | "status"
  >;
  author: { id: string; username: string; displayName: string };
  viewer: PostRenderViewer | null;
  /** 正文 HTML — 文章页为服务端 markdown 渲染产物；短动态为空串（客户端渲染） */
  html: string;
  /** 正文前附加输出 */
  prepend: (html: string) => void;
  /** 正文后附加输出 */
  append: (html: string) => void;
  /** 扩展元数据（键约定 `ext.<id>.*`），随 RSC 下发到 post:actions/detail 槽位 */
  meta: Record<string, unknown>;
  /** 打断渲染 — 首次调用生效 */
  interrupt: (info: PostRenderInterrupt) => void;
  interrupted: PostRenderInterrupt | null;
}

export type PostRenderFilter = (ctx: PostRenderContext) => void | Promise<void>;

const g = globalThis as unknown as {
  __mbPostRenderFilters?: Map<string, { order: number; fn: PostRenderFilter }>;
};
const filters: Map<string, { order: number; fn: PostRenderFilter }> =
  (g.__mbPostRenderFilters ??= new Map());

export function registerPostRenderFilter(name: string, fn: PostRenderFilter, order = 100): void {
  filters.set(name, { order, fn });
}

export interface PostRenderResult {
  ctx: PostRenderContext;
  prependHtml: string;
  appendHtml: string;
}

/** 在文章/短动态详情页调用：按 order 依次执行过滤器，收集输出。 */
export async function runPostRenderPipeline(input: {
  post: PostRenderContext["post"];
  author: { id: string; username: string; displayName: string };
  viewer: User | null;
  html: string;
}): Promise<PostRenderResult> {
  const before: string[] = [];
  const after: string[] = [];
  const ctx: PostRenderContext = {
    post: input.post,
    author: input.author,
    viewer: input.viewer ? { id: input.viewer.id, role: input.viewer.role } : null,
    html: input.html,
    meta: {},
    interrupted: null,
    prepend: (h) => before.push(h),
    append: (h) => after.push(h),
    interrupt: (info) => {
      if (!ctx.interrupted) ctx.interrupted = info;
    },
  };

  const sorted = [...filters.entries()].sort((a, b) => a[1].order - b[1].order);
  for (const [name, { fn }] of sorted) {
    try {
      await fn(ctx);
    } catch (err) {
      // 单个扩展失败不阻断渲染
      console.error(`[post-render:${name}]`, err);
    }
  }

  const [prependHtml, appendHtml] = await Promise.all([
    sanitizeExtensionHtml(before.join("\n")),
    sanitizeExtensionHtml(after.join("\n")),
  ]);
  return { ctx, prependHtml, appendHtml };
}
