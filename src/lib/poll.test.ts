import { describe, expect, it } from "vitest";
import {
  POLL_PK_OPTIONS,
  validatePollOptionsForMode,
} from "@/lib/poll";

/** PK 内容类型：mode 感知的投票校验（A/B 两方对战，恒 2 选项）。 */
describe("validatePollOptionsForMode", () => {
  const good2 = ["方案 A", "方案 B"];

  it("PK：恰好 2 个有效选项通过", () => {
    expect(validatePollOptionsForMode("pk", good2)).toBeNull();
  });

  it("PK：选项数不是 2 → 拒绝（1 个或 3 个都不行）", () => {
    expect(validatePollOptionsForMode("pk", ["只有 A"])).not.toBeNull();
    expect(validatePollOptionsForMode("pk", [...good2, "方案 C"])).not.toBeNull();
  });

  it("PK：空选项走通用规则拒绝", () => {
    expect(validatePollOptionsForMode("pk", ["A", ""])).not.toBeNull();
  });

  it("single/multiple 走通用 2–5 规则", () => {
    expect(validatePollOptionsForMode("single", good2)).toBeNull();
    expect(validatePollOptionsForMode("multiple", ["1", "2", "3"])).toBeNull();
  });

  it("PK 常量为 2（契约哨兵）", () => {
    expect(POLL_PK_OPTIONS).toBe(2);
  });
});
