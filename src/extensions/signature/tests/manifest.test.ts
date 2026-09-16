import { describe, expect, it } from "vitest";
import { coerceExtSettings } from "@/core/capabilities/manifest";
import manifest from "../manifest";

/**
 * 签名档扩展 · 设置收敛单测（纯函数，无需数据库）。
 * 运行：pnpm ext test signature
 */
describe("signature settings coercion", () => {
  it("应用默认值（空输入）", () => {
    const s = coerceExtSettings(manifest, {});
    expect(s.enabled).toBe(false);
    expect(s.placement).toBe("append");
    expect(s.loginRequired).toBe(false);
  });

  it("透传合法值", () => {
    const s = coerceExtSettings(manifest, {
      enabled: true,
      content: "由 comit.sh 强力驱动",
      placement: "prepend",
      loginRequired: true,
    });
    expect(s.enabled).toBe(true);
    expect(s.content).toBe("由 comit.sh 强力驱动");
    expect(s.placement).toBe("prepend");
  });

  it("拒绝未声明的键并截断超长内容", () => {
    const s = coerceExtSettings(manifest, {
      hacker: "x",
      content: "a".repeat(500),
    });
    expect("hacker" in s).toBe(false);
    expect((s.content as string).length).toBe(200);
  });

  it("placement 非法值回落到首个选项", () => {
    const s = coerceExtSettings(manifest, { placement: "middle" });
    expect(s.placement).toBe("append");
  });
});
