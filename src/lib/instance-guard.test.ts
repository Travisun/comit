import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInstanceGuard } from "../../scripts/lib/instance-guard.mjs";

/**
 * dev 依赖实例守卫（scripts/lib/instance-guard.mjs）回归测试。
 *
 * 背景：next 实例目录更换（react 升级 / pnpm patch 增删改）后，
 * .next/dev 持久缓存里引用旧绝对路径的编译单元若不清除，会与新代际
 * chunk 混用，产生 "module factory is not available" 等连环错误。
 *
 * 注意：符号链接目标必须是真实存在的目录 —— 守卫用 existsSync 判断
 * node_modules/next，而 existsSync 会跟随链接，悬空链接恒为 false。
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mb-instance-guard-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function linkNext(name: string): void {
  const target = join(root, "instances", name);
  mkdirSync(target, { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(target, join(root, "node_modules", "next"));
}

function makeDevCache(): void {
  mkdirSync(join(root, ".next", "dev"), { recursive: true });
  writeFileSync(join(root, ".next", "dev", "marker"), "stale");
}

function refValue(): string | null {
  const refFile = join(root, "node_modules", ".cache", "mb-next-ref");
  return existsSync(refFile) ? readFileSync(refFile, "utf8") : null;
}

describe("runInstanceGuard", () => {
  it("首次运行：无 .next/dev 时只记录 ref，不清除", () => {
    linkNext("instance-a");
    const logs: string[] = [];
    const cleared = runInstanceGuard({ root, log: (m) => logs.push(m) });
    expect(cleared).toBe(false);
    expect(logs).toHaveLength(0);
    expect(refValue()).toContain("instances/instance-a");
  });

  it("ref 变化且存在 .next/dev → 清除缓存并更新 ref", () => {
    linkNext("instance-a");
    runInstanceGuard({ root });
    makeDevCache();
    rmSync(join(root, "node_modules", "next"));
    linkNext("instance-b");

    const logs: string[] = [];
    const cleared = runInstanceGuard({ root, log: (m) => logs.push(m) });

    expect(cleared).toBe(true);
    expect(logs).toHaveLength(1);
    expect(existsSync(join(root, ".next", "dev"))).toBe(false);
    expect(refValue()).toContain("instances/instance-b");
  });

  it("ref 状态缺失（全新安装/状态丢失）但缓存存在 → 保守清除", () => {
    linkNext("instance-a");
    makeDevCache();
    // 不先运行守卫：ref 文件不存在，缓存代际出处无法证明

    const cleared = runInstanceGuard({ root });

    expect(cleared).toBe(true);
    expect(existsSync(join(root, ".next", "dev"))).toBe(false);
    expect(refValue()).toContain("instances/instance-a");
  });

  it("ref 未变化 → 不清除（保留增量编译缓存）", () => {
    linkNext("instance-a");
    runInstanceGuard({ root });
    makeDevCache();

    const cleared = runInstanceGuard({ root });

    expect(cleared).toBe(false);
    expect(existsSync(join(root, ".next", "dev", "marker"))).toBe(true);
  });

  it("ref 变化但无 .next/dev → 只更新 ref，无需清除", () => {
    linkNext("instance-a");
    runInstanceGuard({ root });
    rmSync(join(root, "node_modules", "next"));
    linkNext("instance-b");

    const cleared = runInstanceGuard({ root });

    expect(cleared).toBe(false);
    expect(refValue()).toContain("instances/instance-b");
  });
});
