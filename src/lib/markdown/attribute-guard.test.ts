// 被测模块：src/lib/markdown/attribute-guard.ts —— 用户（博主）可控 target/rel/class
// 收口 transform（纯树操作）与两条管线（markdown renderMarkdown / 扩展注入
// sanitizeExtensionHtml）的端到端集成行为。
import { describe, expect, it } from "vitest";
import type { Element, Properties, Root } from "hast";
import {
  guardClassTokens,
  guardRelTokens,
  guardTargetValue,
  MAX_CLASSES_PER_ELEMENT,
  rehypeGuardAttributes,
} from "@/lib/markdown/attribute-guard";
import { renderMarkdown } from "@/lib/markdown/server";
import { sanitizeExtensionHtml } from "@/core/capabilities/post-render";

const guard = rehypeGuardAttributes();

// properties 用宽类型（string 形态 rel 等 hast 规范化前形态也要能构造）
const el = (
  tagName: string,
  properties: Record<string, unknown>,
  children: Element["children"] = [],
): Element => ({
  type: "element",
  tagName,
  properties: properties as Properties,
  children,
});
const root = (children: Element["children"]): Root => ({ type: "root", children });
const propsOf = (node: Root["children"][number]): Record<string, unknown> => (node as Element).properties;

describe("guardTargetValue · target 白名单", () => {
  it("仅 _blank/_self 通过（大小写/首尾空白归一）", () => {
    expect(guardTargetValue("_blank")).toBe("_blank");
    expect(guardTargetValue(" _self ")).toBe("_self");
    expect(guardTargetValue("_BLANK")).toBe("_blank");
  });

  it("任意窗口名/父框架/javascript 伪值一律拒绝", () => {
    for (const v of ["_parent", "_top", "myframe", "javascript:alert(1)", "", 42, null, ["_blank"]]) {
      expect(guardTargetValue(v as never), String(v)).toBeNull();
    }
  });
});

describe("guardRelTokens · rel 白名单交集", () => {
  it("合法 token 保留并归一小写、去重", () => {
    expect(guardRelTokens(["NOFOLLOW", "noopener", "nofollow", "evil"])).toEqual(["nofollow", "noopener"]);
  });

  it("字符串形态按空格分词", () => {
    expect(guardRelTokens("nofollow  external\tx")).toEqual(["nofollow", "external"]);
  });

  it("全部非法 → 空数组；非字符串/数组输入 → 空数组", () => {
    expect(guardRelTokens("sponsored ugc malicious")).toEqual([]);
    expect(guardRelTokens(undefined)).toEqual([]);
    expect(guardRelTokens(123)).toEqual([]);
  });

  it("白名单覆盖 noopener/noreferrer/nofollow/external/author/license 等", () => {
    const all = "noopener noreferrer nofollow external author license alternate bookmark help next prev tag me";
    expect(guardRelTokens(all)).toEqual(all.split(" "));
  });
});

describe("guardClassTokens · class 正则 + 限量", () => {
  it("合法 class 保留（字母开头 + [a-zA-Z0-9_-]，长度 ≤64）", () => {
    expect(guardClassTokens(["ok", "Foo-1_bar", "a".repeat(64)])).toEqual(["ok", "Foo-1_bar", "a".repeat(64)]);
  });

  it("选择器注入/侧信道字符与非法开头全部丢弃", () => {
    const evil = ["1abc", "-x", "_x", "bad!class", "a{color:red}", "b[c=d]", "c:d", "*d", "含中文", "x".repeat(65)];
    expect(guardClassTokens(evil)).toEqual([]);
  });

  it("去重且总量截断到 MAX_CLASSES_PER_ELEMENT（保留前 N 个）", () => {
    const many = Array.from({ length: MAX_CLASSES_PER_ELEMENT + 15 }, (_, i) => `c${i}`);
    const out = guardClassTokens(many);
    expect(out).toHaveLength(MAX_CLASSES_PER_ELEMENT);
    expect(out[0]).toBe("c0");
    expect(out[out.length - 1]).toBe(`c${MAX_CLASSES_PER_ELEMENT - 1}`);
    expect(guardClassTokens([...many, ...many])).toEqual(out);
  });
});

describe("rehypeGuardAttributes · hast 树内收口", () => {
  it("非法 target 删除；rel 清洗后为空则删除属性", () => {
    const tree = root([el("a", { href: "/x", target: "_parent", rel: ["evil"] })]);
    guard(tree);
    const p = propsOf(tree.children[0]);
    expect(p.target).toBeUndefined();
    expect(p.rel).toBeUndefined();
  });

  it("_blank 恒补 noopener（原本无 rel / rel 全非法两种情形）", () => {
    const tree = root([
      el("a", { href: "/x", target: "_blank" }),
      el("a", { href: "/y", target: "_blank", rel: ["evil"] }),
    ]);
    guard(tree);
    expect(propsOf(tree.children[0]).rel).toEqual(["noopener"]);
    expect(propsOf(tree.children[1]).rel).toEqual(["noopener"]);
  });

  it("_self 不强制 noopener；合法 rel 交集保留", () => {
    const tree = root([el("a", { target: "_self", rel: "nofollow sponsored evil" })]);
    guard(tree);
    expect(propsOf(tree.children[0])).toMatchObject({ target: "_self", rel: ["nofollow"] });
  });

  it("字符串形态 rel 归一为数组", () => {
    const tree = root([el("a", { rel: "nofollow noopener" })]);
    guard(tree);
    expect(propsOf(tree.children[0]).rel).toEqual(["nofollow", "noopener"]);
  });

  it("className 数组清洗：非法 token 丢弃、合法保留、全非法删属性", () => {
    const tree = root([
      el("div", { className: ["keep-me", "1bad", "also_ok"] }),
      el("span", { className: ["}inject{"] }),
    ]);
    guard(tree);
    expect(propsOf(tree.children[0]).className).toEqual(["keep-me", "also_ok"]);
    expect(propsOf(tree.children[1]).className).toBeUndefined();
  });

  it("防御性兼容原始 class 键：合并进 className 后收口，class 键删除", () => {
    const tree = root([el("p", { class: "raw-a raw-b", className: ["from-array"] })]);
    guard(tree);
    const p = propsOf(tree.children[0]);
    expect(p.class).toBeUndefined();
    expect(p.className).toEqual(["from-array", "raw-a", "raw-b"]);
  });

  it("非 a 元素的 rel 同样清洗；无 target/rel/class 的节点零改动", () => {
    const tree = root([el("span", { rel: "evil noopener" }), el("p", { className: ["ok"] })]);
    guard(tree);
    expect(propsOf(tree.children[0]).rel).toEqual(["noopener"]);
    expect(propsOf(tree.children[1])).toEqual({ className: ["ok"] });
  });
});

describe("renderMarkdown 集成 · 用户 raw HTML 属性收口", () => {
  it("<a target=任意值> 被删；非法 rel 词被剔除", async () => {
    const r = await renderMarkdown('<a href="/docs" target="evilframe" rel="sponsored xss">t</a>');
    expect(r.html).not.toContain("target");
    expect(r.html).not.toMatch(/rel="[^"]*(sponsored|xss)/);
  });

  it("站外链接经 external guard 恒为 _blank + noopener（收口与既有语义一致）", async () => {
    const r = await renderMarkdown('<a href="https://external.example/x" target="_parent" rel="pwn">t</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain("noopener");
    expect(r.html).not.toMatch(/rel="[^"]*\bpwn\b/);
  });

  it("站内 _blank 锚点补 noopener", async () => {
    const r = await renderMarkdown('<a href="/u/alice" target="_blank">me</a>');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toMatch(/rel="[^"]*noopener/);
  });

  it("合法 class 保留、注入型 class 丢弃、总量截断", async () => {
    const many = Array.from({ length: MAX_CLASSES_PER_ELEMENT + 10 }, (_, i) => `c${i}`).join(" ");
    const r = await renderMarkdown(`<div class="keep_me ${many} 1bad a{color:red}">x</div>`);
    expect(r.html).toContain("keep_me");
    expect(r.html).not.toContain("1bad");
    expect(r.html).not.toContain("color:red");
    const emitted = (r.html.match(/class="([^"]*)"/) ?? ["", ""])[1].split(/\s+/).filter(Boolean);
    expect(emitted.length).toBeLessThanOrEqual(MAX_CLASSES_PER_ELEMENT);
  });

  it("markdown 链接语法（非 raw HTML）不受影响", async () => {
    const r = await renderMarkdown("[link](/about)");
    expect(r.html).toContain('<a href="/about">link</a>');
  });
});

describe("sanitizeExtensionHtml 集成 · 扩展注入 HTML 属性收口", () => {
  it("非法 target 删除、rel 非法词剔除、全非法 rel 删属性", async () => {
    const out = await sanitizeExtensionHtml('<a href="https://ext.example/s" target="whatever" rel="evil">x</a>');
    expect(out).not.toContain("target");
    expect(out).not.toMatch(/rel="[^"]*evil/);
  });

  it("extension HTML 的 _blank 恒含 noopener", async () => {
    const blank = await sanitizeExtensionHtml('<a href="https://ext.example/s" target="_blank" rel="bad">x</a>');
    expect(blank).toContain('target="_blank"');
    expect(blank).toMatch(/rel="[^"]*noopener/);
    expect(blank).not.toMatch(/rel="[^"]*\bbad\b/);
  });

  it("class 名合规定长限量（选择器注入字符丢弃、合法保留）", async () => {
    const out = await sanitizeExtensionHtml('<div class="ext-card pwn{position:fixed} 1x">y</div>');
    expect(out).toContain("ext-card");
    expect(out).not.toContain("position");
    expect(out).not.toContain("1x");
  });

  it("可信内置输出（签名档 Tailwind class）不被误伤", async () => {
    const out = await sanitizeExtensionHtml(
      '<div class="ext-signature mt-4 border-t border-border pt-3 text-sm text-muted-foreground whitespace-pre-wrap">签名</div>',
    );
    expect(out).toContain("ext-signature");
    expect(out).toContain("whitespace-pre-wrap");
  });
});
