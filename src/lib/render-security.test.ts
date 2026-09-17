import { describe, expect, it } from "vitest";
import { safeJsonLd } from "@/lib/seo";
import { postVisibleTo } from "@/components/user-space/queries";

/**
 * 渲染层安全边界回归：
 *  - safeJsonLd：JSON-LD 内用户输入（displayName/title）含 </script>、<
 *    U+2028 时不得逃逸 <script> 上下文（存储型 XSS 防线）；
 *  - postVisibleTo：followers-only 门禁语义（/p/{id} 直链曾完全绕过）。
 */
describe("safeJsonLd", () => {
  it("</script> 被转义，无法提前终止脚本标签", () => {
    const out = safeJsonLd({ name: '</script><script src="//evil.com"></script>' });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script\\u003e");
  });

  it("裸 < 一律转义", () => {
    const out = safeJsonLd({ a: "<img src=x onerror=alert(1)>" });
    expect(out).not.toContain("<img");
  });

  it("U+2028/2029 行分隔符被转义（JS 语法边界）", () => {
    const out = safeJsonLd({ a: "line\u2028sep\u2029next" });
    expect(out).not.toContain("\u2028");
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });

  it("普通内容保持合法 JSON", () => {
    const obj = { name: "张三", bio: "正常简介" };
    expect(JSON.parse(safeJsonLd(obj))).toEqual(obj);
  });
});

describe("postVisibleTo（followers 门禁）", () => {
  const post = { visibility: "followers" as const, authorId: "author-1" };

  it("followers-only：匿名不可见", () => {
    expect(postVisibleTo(post, null)).toBe(false);
  });

  it("followers-only：关注者可见", () => {
    expect(postVisibleTo(post, { id: "u-2", following: true })).toBe(true);
  });

  it("followers-only：非关注者不可见", () => {
    expect(postVisibleTo(post, { id: "u-2", following: false })).toBe(false);
  });

  it("followers-only：作者本人始终可见", () => {
    expect(postVisibleTo(post, { id: "author-1", following: false })).toBe(true);
  });

  it("public：任何人可见", () => {
    expect(postVisibleTo({ visibility: "public", authorId: "a" }, null)).toBe(true);
  });
});
