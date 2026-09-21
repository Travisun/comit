// 被测模块：src/db/seed-policy.ts（db:seed 口令策略，纯函数）。
// 公开前加固：生产拒绝 seed / 非交互无口令拒绝 / 交互式随机一次性口令 /
// 弱口令拒绝 / 演示用户 --demo 门控。全程无 DB / env 副作用（env 以参数注入）。
import { describe, expect, it } from "vitest";
import { generateSeedPassword, resolveSeedPolicy, type SeedPolicyInput } from "./seed-policy";

const base: SeedPolicyInput = { env: {}, argv: [], isTTY: false };

describe("resolveSeedPolicy · 环境门槛", () => {
  it("NODE_ENV=production 一律拒绝（即使提供了口令）", () => {
    const r = resolveSeedPolicy({ ...base, env: { NODE_ENV: "production", ADMIN_PASSWORD: "Str0ngPass123" } });
    expect(r.action).toBe("refuse");
    if (r.action === "refuse") expect(r.reason).toContain("production");
  });

  it("非交互（无 TTY）未提供口令 ⇒ 拒绝并提示环境变量用法", () => {
    const r = resolveSeedPolicy(base);
    expect(r.action).toBe("refuse");
    if (r.action === "refuse") {
      expect(r.reason).toContain("ADMIN_PASSWORD");
      expect(r.reason).toContain("SEED_ADMIN_PASSWORD");
    }
  });

  it("交互式开发未提供口令 ⇒ 生成一次性随机强口令（generated=true）", () => {
    const r = resolveSeedPolicy({ ...base, isTTY: true });
    expect(r.action).toBe("proceed");
    if (r.action === "proceed") {
      expect(r.generated).toBe(true);
      expect(r.adminPassword.length).toBeGreaterThanOrEqual(8);
      expect(r.adminPassword).toMatch(/[a-zA-Z]/);
      expect(r.adminPassword).toMatch(/\d/);
    }
  });
});

describe("resolveSeedPolicy · 环境变量口令", () => {
  it("ADMIN_PASSWORD 优先且按提供值使用（generated=false）", () => {
    const r = resolveSeedPolicy({ ...base, env: { ADMIN_PASSWORD: "MySup3rSecret" } });
    expect(r.action === "proceed" && r.adminPassword).toBe("MySup3rSecret");
    expect(r.action === "proceed" && r.generated).toBe(false);
  });

  it("未提供 ADMIN_PASSWORD 时回落 SEED_ADMIN_PASSWORD", () => {
    const r = resolveSeedPolicy({ ...base, env: { SEED_ADMIN_PASSWORD: "Seed0nlyPass" } });
    expect(r.action === "proceed" && r.adminPassword).toBe("Seed0nlyPass");
  });

  it("弱口令（<8 位 / 缺字母 / 缺数字）拒绝执行", () => {
    for (const weak of ["Admin123456".slice(0, 6), "alllettters", "123456789"]) {
      const r = resolveSeedPolicy({ ...base, env: { ADMIN_PASSWORD: weak } });
      expect(r.action, `口令 "${weak}" 应被拒绝`).toBe("refuse");
    }
  });

  it("纯空白口令等同未提供（非交互 ⇒ 拒绝）", () => {
    const r = resolveSeedPolicy({ ...base, env: { ADMIN_PASSWORD: "   " } });
    expect(r.action).toBe("refuse");
  });
});

describe("resolveSeedPolicy · --demo 门控", () => {
  it("默认不创建演示用户", () => {
    const r = resolveSeedPolicy({ ...base, env: { ADMIN_PASSWORD: "Str0ngPass123" } });
    expect(r.action === "proceed" && r.demoUsers).toBe(false);
  });

  it("显式 --demo 时创建演示用户", () => {
    const r = resolveSeedPolicy({
      ...base,
      argv: ["--demo"],
      env: { ADMIN_PASSWORD: "Str0ngPass123" },
    });
    expect(r.action === "proceed" && r.demoUsers).toBe(true);
  });
});

describe("generateSeedPassword", () => {
  it("满足注册侧口令策略（≥8 位、含字母与数字）", () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateSeedPassword();
      expect(pw.length).toBe(20);
      expect(pw).toMatch(/[a-zA-Z]/);
      expect(pw).toMatch(/\d/);
    }
  });

  it("两次生成几乎不可能相同（随机源有效）", () => {
    expect(generateSeedPassword()).not.toBe(generateSeedPassword());
  });
});
