// @vitest-environment happy-dom
/**
 * 被测模块：src/lib/svg-sanitizer.ts —— mermaid 渲染 SVG 注入前的双层净化。
 * happy-dom 提供 DOMParser/XMLSerializer/window，DOMPurify 走浏览器路径。
 */
import { describe, expect, it } from "vitest";
import { isDangerousUri, sanitizeSvgForInjection, scrubSvgTree } from "./svg-sanitizer";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("isDangerousUri · 协议判定（纯字符串）", () => {
  it("识别 javascript:/vbscript: 及其空白干扰", () => {
    expect(isDangerousUri("javascript:alert(1)")).toBe(true);
    expect(isDangerousUri("  Java\tScript:alert(1)")).toBe(true);
    expect(isDangerousUri("vbscript:msgbox")).toBe(true);
  });
  it("正常 URI 放行（data:image 由 DOMPurify 层按属性白名单处理，不误伤 xlink:href）", () => {
    expect(isDangerousUri("#")).toBe(false);
    expect(isDangerousUri("https://example.com/a")).toBe(false);
    expect(isDangerousUri("data:image/svg+xml;base64,AAA=")).toBe(false);
  });
});

describe("sanitizeSvgForInjection · 注入净化（e2e，浏览器同构路径）", () => {
  it("剥离 <script>（连内容）", () => {
    const dirty = `<svg xmlns="${SVG_NS}" width="20" height="20"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
    const out = sanitizeSvgForInjection(dirty);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<rect"); // 正常图元保留
  });

  it("剥离 on* 事件属性", () => {
    const dirty = `<svg xmlns="${SVG_NS}"><rect width="10" height="10" onclick="alert(1)" onload="steal()"/></svg>`;
    const out = sanitizeSvgForInjection(dirty);
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onload");
    expect(out).toContain("<rect");
  });

  it("剥离 foreignObject 整棵子树", () => {
    const dirty = `<svg xmlns="${SVG_NS}"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject><text>keep</text></svg>`;
    const out = sanitizeSvgForInjection(dirty);
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toContain("onerror");
    expect(out).toContain("keep");
  });

  it("剥离 javascript: 协议的 href / xlink:href", () => {
    const dirty = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"><a href="javascript:alert(1)"><text>nav</text></a><a xlink:href="JaVaScRiPt:alert(2)"><text>nav2</text></a></svg>`;
    const out = sanitizeSvgForInjection(dirty);
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("nav");
  });

  it("合法 mermaid 风格 SVG 结构基本保留（g/path/class/style）", () => {
    const nice = `<svg xmlns="${SVG_NS}" width="100" height="50"><style>.cls-1{fill:red}</style><g class="root"><path class="cls-1" d="M0 0 L10 10"/><text text-anchor="middle">hi</text></g></svg>`;
    const out = sanitizeSvgForInjection(nice);
    expect(out).toContain("<g");
    expect(out).toContain("<path");
    expect(out).toContain("hi");
  });

  it("非 SVG 输入 / 解析失败 fail-closed 为空串", () => {
    expect(sanitizeSvgForInjection("not svg at all <<<")).toBe("");
    expect(sanitizeSvgForInjection(123 as unknown as string)).toBe("");
  });
});

describe("scrubSvgTree · 第二层剥离（直接喂污染 DOM，绕开 DOMPurify）", () => {
  it("DOMPurify 缺席时仍能独立剥离 script/foreignObject/on*/javascript:", () => {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}"><script/><rect onclick="x"/><foreignObject/><a href="javascript:1"/></svg>`,
      "image/svg+xml",
    );
    const removed = scrubSvgTree(doc);
    expect(removed).toBeGreaterThanOrEqual(4); // script + onclick + foreignObject + href
    const s = new XMLSerializer().serializeToString(doc.documentElement);
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/foreignObject/i);
    expect(s).not.toContain("onclick");
    expect(s).not.toContain("javascript:");
    expect(s).toContain("<rect");
    expect(s).toContain("<a");
  });

  it("Element 根同样生效（不限 Document）", () => {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}"><g><rect onmouseover="evil()"/></g></svg>`,
      "image/svg+xml",
    );
    const removed = scrubSvgTree(doc.documentElement);
    expect(removed).toBe(1);
  });

  it("命名空间前缀变体的 :href 也被检查（xlink:href 带危险协议）", () => {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="&#106;avascript:alert(1)"/></svg>`,
      "image/svg+xml",
    );
    scrubSvgTree(doc);
    const s = new XMLSerializer().serializeToString(doc.documentElement);
    expect(s.toLowerCase()).not.toContain("javascript:");
  });
});
