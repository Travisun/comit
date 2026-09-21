// 被测模块：src/lib/auth/password.ts 的令牌原语（随机票据 + 常数时间比较）。
// 关键语义：一次性票据熵随字节数线性增长（base64url 无填充）；safeCompare 对
// 等值/不等值/长度不等/空值一律给出正确判定，且比较成本只与摘要长度有关。
import { describe, expect, it } from "vitest";
import { randomToken, safeCompare, sha256 } from "./password";

describe("randomToken · 一次性票据熵", () => {
  it("32 字节票据 ⇒ 256 位熵（base64url 43 字符，无 padding）", () => {
    const t = randomToken(32);
    expect(t).toHaveLength(43); // ceil(32*8/6)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("16 字节 state/nonce ⇒ ≥128 位熵（OAuth state / SSO nonce 的最低标准）", () => {
    expect(randomToken(16).length * 6).toBeGreaterThanOrEqual(128);
  });

  it("两次签发不同（随机源非确定性）", () => {
    expect(randomToken(32)).not.toBe(randomToken(32));
  });
});

describe("safeCompare · 常数时间票据比较", () => {
  it("等值 ⇒ true；单字符差异 ⇒ false", () => {
    const a = randomToken(16);
    expect(safeCompare(a, a)).toBe(true);
    expect(safeCompare(a, `${a.slice(0, -1)}X`)).toBe(false);
  });

  it("长度不等 ⇒ false（哈希归一定长，不提前短路泄露长度）", () => {
    expect(safeCompare("short", "much-longer-value")).toBe(false);
  });

  it("空值一侧一律 false（空串永远不该被当作有效票据）", () => {
    expect(safeCompare("", "")).toBe(false);
    expect(safeCompare("", "x")).toBe(false);
    expect(safeCompare("x", "")).toBe(false);
  });

  it("比较的是内容而非同一引用（对已泄露哈希值不误判）", () => {
    const secret = randomToken(32);
    expect(safeCompare(sha256(secret), secret)).toBe(false);
  });
});
