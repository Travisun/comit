import { describe, expect, it } from "vitest";
import { normalizeSlug } from "./_shared";

/**
 * slug 白名单回归：合集/话题 slug 会拼进 URL 与 data-slug，未过滤字符等于把
 * 任意文本送进链接（`!` `"` `#` `?` `%` 均可造成跳转/选择器/缓存分歧）。
 */
describe("normalizeSlug", () => {
  it("正常标题走 slugify", () => {
    expect(normalizeSlug("Hello World")).toBe("hello-world");
  });

  it("纯符号名返回 CSPRNG 兜底，且两次不同（不可预测、不互相命中）", () => {
    const a = normalizeSlug("!!!???");
    const b = normalizeSlug("!!!???");
    expect(a).toMatch(/^c-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("输出永不含 URL/选择器危险字符", () => {
    const inputs = [
      'a"b',
      "a#b?c",
      "50%-off",
      "a/b\\c",
      "「尖括号」",
      "<script>",
      "foo bar  ",
      "  ",
      "…♥♥…",
    ];
    for (const input of inputs) {
      const out = normalizeSlug(input);
      expect(out).toMatch(/^[a-z0-9\u4e00-\u9fff-]+$/);
      expect(out).not.toMatch(/[%"'?#<>\\\/&=]/);
    }
  });

  it("CJK 名保留中文，不再回落未过滤原文", () => {
    expect(normalizeSlug("前端！进阶")).toBe("前端进阶");
  });
});
