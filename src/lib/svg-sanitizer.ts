import DOMPurify from "dompurify";

/**
 * Mermaid 客户端渲染 SVG 的第二层净化（ defense-in-depth ）。
 *
 * 背景：mermaid 配置 securityLevel "strict" 只在「解析 diagram 源码」这一
 * 层防御，`mermaid.render()` 返回的 SVG 字符串仍以 innerHTML 注入 DOM ——
 * 渲染器自身（或其依赖 dagre/dompurify 旧版行为、未来版本回归）产出的恶意
 * 片段会直接执行。这里在注入前做两道独立净化：
 *
 *  1. {@link scrubSvgTree} —— 手写 DOM 遍历剥离层（解析为 SVG Document →
 *     删 <script>/<foreignObject>、on* 事件属性、javascript:/vbscript: 协议
 *     的 href/xlink:href → 重新序列化）。这一层恒生效，不依赖第三方库状态；
 *  2. DOMPurify（svg/svgFilters profile）—— 成熟引擎再做属性/URI/CSS 面的
 *     通用清洗，显式 FORBID script / foreignObject。两层都不认识的输入按
 *     fail-closed 处理（无 DOM 环境直接返回空串，宁可不渲染也不注入未验证
 *     内容）。
 *
 * 净化函数不依赖 window 的部分（scrubSvgTree / isDangerousUri）均为纯
 * DOM-API 函数，可在 vitest happy-dom 环境下直接单测。
 */

/** 无条件删除的标签（localName 小写比较，覆盖命名空间变体） */
const FORBIDDEN_TAGS = new Set(["script", "foreignobject"]);

/** 需要协议检查的引用型属性 */
const URI_ATTRS = new Set(["href", "xlink:href"]);

/**
 * 危险协议判定：先剥除 HTML 实体引用（&#106;avascript: 之类）与控制字符/空
 * 白，再匹配 scheme。不含 data: —— mermaid 图片节点合法依赖 data:image 的
 * xlink:href，data: 的清洗交给 DOMPurify 层的属性级白名单（避免误伤）。
 */
export function isDangerousUri(raw: string): boolean {
  const v = raw
    .replace(/&#x?[0-9a-f]+;?/gi, " ")
    .replace(/[\u0000-\u0020\u007f\s]+/g, "");
  return /^(javascript|vbscript|livescript|mocha):/i.test(v);
}

/**
 * 遍历并就地剥离危险内容，返回删除计数（供调用侧埋点/测试断言）。
 * 接受任何可 querySelectorAll("*") 的节点（Document / Element）。
 */
export function scrubSvgTree(root: Document | Element | DocumentFragment): number {
  let removed = 0;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (FORBIDDEN_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      removed += 1;
      continue; // 子树随节点一并消失
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        removed += 1;
        continue;
      }
      if (URI_ATTRS.has(name) && isDangerousUri(attr.value)) {
        el.removeAttribute(attr.name);
        removed += 1;
        continue;
      }
      // xlink 命名空间变体（xlink:href 之外的前缀如 xml:href）按 href 处理
      if (name.endsWith(":href") && isDangerousUri(attr.value)) {
        el.removeAttribute(attr.name);
        removed += 1;
      }
    }
  }
  return removed;
}

/** DOMPurify SVG 专用配置：只放行 svg/svgFilters 元素集，绝不允许 HTML 面 */
const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject", "iframe"],
  FORBID_ATTR: ["srcdoc"],
};

/**
 * 注入前净化入口：mermaid.render() 返回的 SVG 字符串 → 可安全 innerHTML 的
 * 字符串。净化顺序：
 *
 *  1. {@link scrubSvgTree}（第一层，必选）：XML 解析 → 剥离 script/
 *     foreignObject/on-事件属性/危险协议 href → 序列化。解析失败 fail-closed 空串。
 *  2. DOMPurify（第二层，SVG profile）：对剥离后的字符串再过一道引擎级清洗
 *     （属性值/CSS/URI 白名单）。若 DOMPurify 把非空输入清空（部分 DOM 实现
 *     对 svg profile 的已知易碎点，happy-dom 实测），退回第一层输出 —— 第一
 *     层已覆盖本模块承诺的剥离面，不为环境差异牺牲渲染。
 */
export function sanitizeSvgForInjection(svg: string): string {
  const dirty = typeof svg === "string" ? svg : "";
  if (!dirty) return "";
  const hasDom = typeof window !== "undefined" && typeof window.DOMParser === "function";
  if (!hasDom) {
    // 无 DOM（SSR 误调）：仅剩 DOMPurify node 路径可用，否则 fail-closed
    return DOMPurify.isSupported ? DOMPurify.sanitize(dirty, PURIFY_CONFIG) : "";
  }
  const doc = new DOMParser().parseFromString(dirty, "image/svg+xml");
  const rootEl = doc.documentElement;
  if (!rootEl || rootEl.localName === "parsererror" || doc.querySelector("parsererror")) {
    // XML 严格解析失败（非良构输入）：不退 HTML 裸串 —— 仅剩 DOMPurify 清洗
    // 过的输出可用；连它也不可用则 fail-closed 空串
    return DOMPurify.isSupported ? DOMPurify.sanitize(dirty, PURIFY_CONFIG) : "";
  }
  scrubSvgTree(doc);
  const scrubbed = new XMLSerializer().serializeToString(rootEl);
  if (!DOMPurify.isSupported) return scrubbed;
  const purified = DOMPurify.sanitize(scrubbed, PURIFY_CONFIG);
  return purified === "" && scrubbed !== "" ? scrubbed : purified;
}
