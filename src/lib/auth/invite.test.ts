// 被测模块：src/lib/auth/invite.ts 的邀请码形状判定（generateInviteCode）。
// 纯函数测试：不落库（本文件只覆盖生成器的熵/字符集/唯一性，DB 侧单次消费由
// register 事务内的 UPDATE … WHERE used_at IS NULL 保证）。
import { describe, expect, it, vi } from "vitest";
import { generateInviteCode } from "./invite";

// 依赖 mock：@/db（模块顶层 import 会建 pg Pool，测试不触库）
vi.mock("@/db", () => ({ db: {} }));

describe("generateInviteCode · 可猜测性", () => {
  it("16 位大写十六进制（8 字节 = 64 位熵），且适配 invites.code varchar(16)", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[0-9A-F]{16}$/);
    expect(code.length * 4).toBeGreaterThanOrEqual(64);
  });

  it("不再是旧实现的 32 位（9 字符 XXXX-XXXX）形状 ⇒ 离线穷举邀请码不可行", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateInviteCode()).toMatch(/^[0-9A-F]{16}$/);
    }
  });

  it("批量生成无碰撞（唯一索引 invites_code_key 的乐观前提）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(2_000);
  });
});
