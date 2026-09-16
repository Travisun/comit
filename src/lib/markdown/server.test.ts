// 被测模块：src/lib/markdown/server.ts —— rehypeTightenStyles（style 收紧 transform，纯函数）
// 与 renderMarkdown 管线的 sanitize/收紧安全行为（script 剥除、img src 协议白名单）。
import { describe, expect, it } from "vitest";
import type { Element, Root, RootContent } from "hast";
import { rehypeTightenStyles, renderMarkdown } from "./server";

const tighten = rehypeTightenStyles();

const el = (tagName: string, style?: string, children: Element["children"] = []): Element => ({
  type: "element",
  tagName,
  properties: style === undefined ? {} : { style },
  children,
});

const root = (children: Element["children"]): Root => ({ type: "root", children });

/** 运行 transform 后按 path 逐层下钻，取回目标元素的 style 属性 */
function styleAfter(tree: Root, path: number[]): string | undefined {
  let children: RootContent[] = tree.children;
  let target: RootContent | undefined;
  for (const i of path) {
    target = children[i];
    if (!target || target.type !== "element") throw new Error(`path ${path.join("/")} 未命中元素节点`);
    children = target.children;
  }
  if (!target || target.type !== "element") return undefined;
  const style = target.properties?.style;
  if (style === undefined) return undefined;
  expect(typeof style, "style 应为字符串").toBe("string");
  return style as string;
}

describe("rehypeTightenStyles · 普通元素（严格白名单）", () => {
  it("仅保留 color / background-color / font-weight / font-style", () => {
    const tree = root([el("p", "color:red; font-weight:700; position:fixed; margin:0 auto")]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBe("color:red; font-weight:700");
  });

  it("非白名单属性全部剥除后删除 style 属性本身", () => {
    const tree = root([el("span", "position:fixed; z-index:9999")]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBeUndefined();
  });

  it("白名单属性伪装的 url() 声明同样被值检查剥除（双保险）", () => {
    const tree = root([el("span", "background-color:url(//evil/pixel); color:blue")]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBe("color:blue");
  });

  it("大小写归一匹配属性名（COLOR:red 保留）", () => {
    const tree = root([el("span", "COLOR:red; LEFT:0")]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBe("COLOR:red");
  });

  it("畸形声明（无冒号）被丢弃且不抛错", () => {
    const tree = root([el("span", "color:red; garbagethings;; :;")]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBe("color:red");
  });
});

describe("rehypeTightenStyles · pre/code 子树（低危放宽，高危仍剥）", () => {
  it("position:fixed 全屏覆盖组合被整体剥除", () => {
    const tree = root([el("pre", undefined, [el("span", "position:fixed;top:0;left:0;z-index:9999")])]);
    tighten(tree);
    expect(styleAfter(tree, [0, 0])).toBeUndefined();
  });

  it("background:url() 被剥，安全声明保留", () => {
    const tree = root([el("pre", undefined, [el("span", "background:url(//x/t.gif);color:#0f0")])]);
    tighten(tree);
    expect(styleAfter(tree, [0, 0])).toBe("color:#0f0");
  });

  it("display 与 --shiki-* 自定义属性在 code 子树保留", () => {
    const tree = root([
      el("pre", undefined, [
        el("code", "display:block;--shiki-default:#89ddff;color:#abb2bf"),
      ]),
    ]);
    tighten(tree);
    expect(styleAfter(tree, [0, 0])).toBe("display:block; --shiki-default:#89ddff; color:#abb2bf");
  });

  it("expression() 与视口单位值被剥（width:100vw 撑满全屏）", () => {
    const tree = root([
      el("pre", undefined, [
        el("span", "width:expression(alert(1));min-width:100vw;color:#fff"),
      ]),
    ]);
    tighten(tree);
    expect(styleAfter(tree, [0, 0])).toBe("color:#fff");
  });

  it("pre/code 元素自身也在宽口径范围内（含自身标记）", () => {
    const tree = root([el("pre", "display:flex;position:fixed", [el("code", "color:#fff")])]);
    tighten(tree);
    expect(styleAfter(tree, [0])).toBe("display:flex");
  });

  it("普通段落 span 不享受宽口径（display 被剥）", () => {
    const tree = root([el("p", undefined, [el("span", "display:inline-block;color:red")])]);
    tighten(tree);
    expect(styleAfter(tree, [0, 0])).toBe("color:red");
  });

  it("无 style 属性的树原样通过（不新增属性、不抛错）", () => {
    const tree = root([el("p", undefined, [el("span", undefined, [])])]);
    expect(() => tighten(tree)).not.toThrow();
    expect((tree.children[0] as Element).properties).toEqual({});
  });
});

describe("renderMarkdown · 管线安全行为（e2e，无代码块不触发 shiki）", () => {
  it("script 标签连同内容被整体移除（rehypeDropDangerous 生效性断言）", async () => {
    // rehypeDropDangerous 位于 sanitize 之前，将危险元素**连子内容**移除——
    // 断言脚本文本本身也不出现在输出中：若该函数回退为空操作（历史 bug：
    // visit(tree,"parent",…) 命中 0 节点），仅靠 sanitize 的「去壳留文本」
    // 语义这里会残留 alert(1)，用例即失败。
    const { html } = await renderMarkdown("hello\n\n<script>alert(1)</script>\n");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("hello");
  });

  it("img src data: 被剥、https 保留", async () => {
    const { html } = await renderMarkdown(
      "![px](data:image/png;base64,iVBORw0KGgo=)\n\n![ok](https://example.com/x.png)\n",
    );
    expect(html).not.toContain("data:image");
    expect(html).toContain('src="https://example.com/x.png"');
  });

  it("pre 内 span 全屏覆盖层 style 被剥（覆盖钓鱼防护 e2e）", async () => {
    const { html } = await renderMarkdown(
      '<pre><span style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:url(//evil/x)">COVER</span></pre>',
    );
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("100vw");
    expect(html).not.toContain("url(");
    expect(html).toContain("COVER");
  });

  it("pre 内安全配色声明保留（用户代码块内联样式不误伤）", async () => {
    const { html } = await renderMarkdown(
      '<pre><span style="color:#0f0;display:inline">ok</span></pre>',
    );
    expect(html).toContain("color:#0f0");
    expect(html).toContain("display:inline");
  });

  it("普通段落行内 style 走严格白名单", async () => {
    const { html } = await renderMarkdown(
      '<span style="color:red;position:absolute;top:0">x</span>',
    );
    expect(html).toContain("color:red");
    expect(html).not.toContain("position:absolute");
  });

  it("标题抽取：h2 生成 slug id 并返回 headings 元数据", async () => {
    const { html, headings } = await renderMarkdown("## Hello World\n");
    expect(headings).toEqual([{ id: "hello-world", text: "Hello World", level: 2 }]);
    expect(html).toContain('id="hello-world"');
  });
});
