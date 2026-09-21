// 被测模块：src/lib/mention-syntax —— 行内 mention/链接语法的唯一消费口径。
// 回归重点：图片语法不能被链接分支吃掉半个 `!`；未展开的稳定引用必须降级为
// @昵称（历史上消费端正则与生产端不一致 → UI 直显 `@[x](mention:uuid)`）；
// 按长度截断只能切文本段，不能把 `[@x](/u/` 切成字面量。
import { describe, expect, it } from "vitest";
import {
  clampInlineSegments,
  mentionSyntaxToPlainText,
  mentionTokenRe,
  parseInlineSegments,
} from "./mention-syntax";

const UID = "345e139d-ad67-4469-83c3-f71e580ac548";

describe("parseInlineSegments", () => {
  it("展开后的 @提及链接成链（label 保留 @）", () => {
    expect(parseInlineSegments("看看 [@武林高萝卜](/u/yohan) 说的")).toEqual([
      { type: "text", text: "看看 " },
      { type: "link", text: "@武林高萝卜", href: "/u/yohan" },
      { type: "text", text: " 说的" },
    ]);
  });

  it("站内相对链接成链", () => {
    expect(parseInlineSegments("[归档](/archives/2026)")).toEqual([
      { type: "link", text: "归档", href: "/archives/2026" },
    ]);
  });

  it("http(s) 链接成链；协议外（javascript:）不成链、原样留作文本", () => {
    expect(parseInlineSegments("[站](https://example.com/a)")).toEqual([
      { type: "link", text: "站", href: "https://example.com/a" },
    ]);
    expect(parseInlineSegments("[x](javascript:alert(1))")).toEqual([
      { type: "text", text: "[x](javascript:alert(1))" },
    ]);
  });

  it("图片语法独立成段，不被链接分支切成 `!` + 断链", () => {
    expect(parseInlineSegments("配图 ![猫](/api/media/file/a.png) 完")).toEqual([
      { type: "text", text: "配图 " },
      { type: "image", text: "猫", src: "/api/media/file/a.png" },
      { type: "text", text: " 完" },
    ]);
  });

  it("换行属于文本段，原样保留（消费方按行/段落自行排版）", () => {
    expect(parseInlineSegments("第一行\n第二行 [@Rui](/u/rui)\n")).toEqual([
      { type: "text", text: "第一行\n第二行 " },
      { type: "link", text: "@Rui", href: "/u/rui" },
      { type: "text", text: "\n" },
    ]);
  });

  it("未展开的稳定引用降级为 @昵称（漏展时也不漏语法）", () => {
    expect(parseInlineSegments(`嗨 @[张三](mention:${UID})`)).toEqual([
      { type: "text", text: "嗨 " },
      { type: "text", text: "@张三" },
    ]);
    expect(mentionSyntaxToPlainText(`嗨 @[张三](mention:${UID})`)).toBe("嗨 @张三");
  });

  it("无语法文本原样单段返回；空串返回空数组", () => {
    expect(parseInlineSegments("纯文本")).toEqual([{ type: "text", text: "纯文本" }]);
    expect(parseInlineSegments("")).toEqual([]);
  });
});

describe("mentionSyntaxToPlainText", () => {
  it("两种形态都拉平为 @昵称（未展开引用 + 已展开链接）", () => {
    const both = `@[旧名](mention:${UID}) 与 [@武林高萝卜](/u/yohan) 和 @路过的文本`;
    expect(mentionSyntaxToPlainText(both)).toBe("@旧名 与 @武林高萝卜 和 @路过的文本");
  });

  it("非提及链接不被动（本函数的职责只有 mention 语法）", () => {
    expect(mentionSyntaxToPlainText("[文档](https://example.com/d)")).toBe(
      "[文档](https://example.com/d)",
    );
  });

  it("幂等：拉平结果再拉平不变（通知正文可能被两侧各处理一次）", () => {
    const once = mentionSyntaxToPlainText(`@[张三](mention:${UID})`);
    expect(mentionSyntaxToPlainText(once)).toBe(once);
  });
});

describe("clampInlineSegments", () => {
  it("截断只落在段内：绝不产出半截链接语法", () => {
    const segments = parseInlineSegments("前文 [@武林高萝卜](/u/yohan) 后文");
    // 逐一切所有可能长度，任何结果都不允许漏出 `](` / `](mention:`
    for (let max = 0; max <= 40; max++) {
      const out = clampInlineSegments(segments, max)
        .map((s) => (s.type === "image" ? "" : s.text))
        .join("");
      expect(out).not.toMatch(/\]\(/);
      expect(out).not.toContain("](mention:");
    }
    expect(clampInlineSegments(segments, 5).map((s) => s.text)).toEqual(["前文 ", "@武", "…"]);
  });

  it("未超长时原样返回、不加省略号", () => {
    const segments = parseInlineSegments("短 [@Rui](/u/rui)");
    expect(clampInlineSegments(segments, 100)).toEqual(segments);
  });
});

describe("mentionTokenRe", () => {
  it("每次给出干净的实例（/g 的 lastIndex 不跨调用残留）", () => {
    const text = `@[a](mention:${UID}) 和 @[b](mention:${UID})`;
    expect(mentionTokenRe().test(text)).toBe(true);
    expect(mentionTokenRe().test(text)).toBe(true);
  });
});
