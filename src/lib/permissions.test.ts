// 被测模块：src/lib/permissions.ts —— 内置角色权限静态映射 + registerPolicy 注册表（覆盖/注销/自定义 action）。
// mock：@/lib/auth/guards（切断 session → db 链路，保持无 DB 可跑）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { can, registerPolicy } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";
import type { AuthContext } from "@/lib/auth/session";

vi.mock("@/lib/auth/guards", () => ({ apiUser: vi.fn(async () => null) }));

type User = AuthContext["user"];
const fakeUser = (role: Role): User => ({ id: "u_test", role, name: "Test" }) as unknown as User;

/** 收集本文件注册的策略注销函数，afterEach 统一还原，避免跨用例串扰 */
const offs: (() => void)[] = [];
afterEach(() => {
  while (offs.length) offs.pop()?.();
});

describe("内置静态映射（PERMISSIONS）", () => {
  it("admin 拥有全部 admin.* 权限", () => {
    const adminOnly = ["admin.settings", "admin.users", "admin.templates", "admin.media", "admin.audit", "admin.ops"];
    for (const action of adminOnly) expect(can("admin", action), `admin 应拥有 ${action}`).toBe(true);
  });

  it("admin 也拥有与 editor 共享的权限", () => {
    const shared = ["admin.access", "admin.dashboard", "admin.moderate", "admin.comments", "admin.reports", "admin.verification", "admin.posts"];
    for (const action of shared) expect(can("admin", action), `admin 应拥有 ${action}`).toBe(true);
  });

  it("editor 有审核台权限，但无 admin.users / admin.settings 等 admin 专属权限", () => {
    for (const action of ["admin.access", "admin.moderate", "admin.posts", "admin.comments"]) {
      expect(can("editor", action), `editor 应拥有 ${action}`).toBe(true);
    }
    for (const action of ["admin.users", "admin.settings", "admin.ops", "admin.audit", "admin.templates", "admin.media"]) {
      expect(can("editor", action), `editor 不应拥有 ${action}`).toBe(false);
    }
  });

  it("user 角色无任何 admin.* 权限", () => {
    const allBuiltin = [
      "admin.access", "admin.dashboard", "admin.moderate", "admin.comments", "admin.reports",
      "admin.verification", "admin.posts", "admin.settings", "admin.users", "admin.templates",
      "admin.media", "admin.audit", "admin.ops",
    ];
    for (const action of allBuiltin) expect(can("user", action), `user 不应拥有 ${action}`).toBe(false);
  });

  it("未注册且不在静态映射的 action 恒为 false（所有角色）", () => {
    for (const role of ["admin", "editor", "user"] as const) {
      expect(can(role, "nope.unknown-action"), `${role} 对未注册 action 应为 false`).toBe(false);
    }
  });
});

describe("registerPolicy 覆盖内置映射", () => {
  it("注册后 can 以策略结果为准（可放宽内置映射）", () => {
    expect(can("editor", "admin.users")).toBe(false); // 内置：admin 专属
    offs.push(
      registerPolicy("admin.users", (ctx) => ctx.role === "admin" || ctx.role === "editor"),
    );
    expect(can("editor", "admin.users")).toBe(true);
    expect(can("user", "admin.users")).toBe(false);
  });

  it("注册后 can 以策略结果为准（可收紧内置映射）", () => {
    expect(can("editor", "admin.moderate")).toBe(true); // 内置放行
    offs.push(registerPolicy("admin.moderate", () => false));
    expect(can("editor", "admin.moderate")).toBe(false);
    expect(can("admin", "admin.moderate")).toBe(false);
  });

  it("同名 action 后注册覆盖前注册", () => {
    offs.push(registerPolicy("custom.later", () => true));
    offs.push(registerPolicy("custom.later", () => false));
    expect(can("admin", "custom.later")).toBe(false);
  });

  it("策略只作用于注册的 action，不泄漏到其它 action", () => {
    offs.push(registerPolicy("admin.users", () => true));
    expect(can("user", "admin.users")).toBe(true); // 策略放行
    expect(can("user", "admin.settings")).toBe(false); // 其它 action 走内置
    expect(can("user", "admin.ops")).toBe(false);
  });

  it("PolicyContext 携带 role，user 缺省为 undefined、传入时原样透传", () => {
    const seen: unknown[] = [];
    offs.push(
      registerPolicy("custom.ctx-probe", (ctx) => {
        seen.push({ ...ctx });
        return true;
      }),
    );
    expect(can("editor", "custom.ctx-probe")).toBe(true);
    expect(seen[0]).toEqual({ role: "editor", user: undefined });

    const user = fakeUser("editor");
    can("editor", "custom.ctx-probe", user);
    expect(seen[1]).toEqual({ role: "editor", user });
  });

  it("注销函数恢复内置映射，且重复注销安全", () => {
    const off = registerPolicy("admin.users", () => true);
    expect(can("user", "admin.users")).toBe(true);
    off();
    expect(can("user", "admin.users")).toBe(false); // 恢复内置
    expect(() => off()).not.toThrow(); // 重复注销是 no-op
    expect(can("user", "admin.users")).toBe(false);
  });
});

describe("自定义 action（显式注册才放行）", () => {
  it("未注册的自定义 action 恒为 false", () => {
    for (const role of ["admin", "editor", "user"] as const) {
      expect(can(role, "ext.never-registered")).toBe(false);
    }
  });

  it("注册的自定义 action 按策略放行（可基于 user 判定，缺省拒绝）", () => {
    offs.push(
      registerPolicy("ext.expand-links", (ctx) => ctx.role === "admin" && ctx.user !== undefined),
    );
    expect(can("admin", "ext.expand-links", fakeUser("admin"))).toBe(true);
    expect(can("admin", "ext.expand-links")).toBe(false); // 缺 user → 策略自行拒绝
    expect(can("editor", "ext.expand-links", fakeUser("editor"))).toBe(false);
    expect(can("user", "ext.expand-links", fakeUser("user"))).toBe(false);
  });
});
