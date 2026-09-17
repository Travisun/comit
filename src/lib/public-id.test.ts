import { describe, expect, it } from "vitest";
import { isPublicIdShape, newPublicId } from "@/lib/public-id";

/** 帖子对外短 ID（Twitter 式数字串 + 去序列化）生成器回归。 */
describe("newPublicId", () => {
  it("纯数字字符串，10~20 位", () => {
    for (let i = 0; i < 200; i++) {
      const id = newPublicId();
      expect(id).toMatch(/^\d{10,20}$/);
    }
  });

  it("值域在 2^62 内（最高字节掩码生效）", () => {
    for (let i = 0; i < 100; i++) {
      expect(BigInt(newPublicId())).toBeLessThan(BigInt(2) ** BigInt(62));
    }
  });

  it("批量生成基本无碰撞（62 位空间）", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newPublicId()));
    expect(ids.size).toBe(5000);
  });

  it("形状判定：数字串通过，uuid/slug 不通过", () => {
    expect(isPublicIdShape("4611686018427387904")).toBe(true);
    expect(isPublicIdShape("5eae12d0-89e9-4ee8-98dd-9a56f22346d3")).toBe(false);
    expect(isPublicIdShape("hello-world")).toBe(false);
  });
});
