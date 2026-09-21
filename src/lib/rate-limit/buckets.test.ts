// 被测模块：src/lib/rate-limit/bucket-manifest.ts（清单完整性）+ src/lib/rate-limit/buckets.ts（后台覆写 sanitize / 键拼装）。
// 依赖 mock：@/lib/settings（受控 getSetting）、@/lib/rate-limit（捕获 rateLimit 入参）——全程无 DB / Redis。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RATE_BUCKETS } from "@/lib/rate-limit/bucket-manifest";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getSetting } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));

const getSettingMock = getSetting as unknown as Mock<() => Promise<unknown>>;
const rateLimitMock = rateLimit as unknown as Mock<(...args: unknown[]) => Promise<void>>;

/** 桶默认值查找表（与 RATE_BUCKETS 对账用） */
const defaults = Object.fromEntries(RATE_BUCKETS.map((b) => [b.name, b]));

beforeEach(() => {
  getSettingMock.mockReset();
  getSettingMock.mockResolvedValue(undefined);
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue(undefined);
});

describe("RATE_BUCKETS 清单完整性", () => {
  it("桶名唯一、非空且符合 name 形状", () => {
    const names = RATE_BUCKETS.map((b) => b.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size, "存在重名桶").toBe(names.length);
    for (const name of names) expect(name, "桶名应为命名空间形状").toMatch(/^[a-z]+(\.[a-z0-9]+)+$/);
  });

  it("每个桶的 limit 与 windowSec 均为正整数", () => {
    for (const b of RATE_BUCKETS) {
      expect(Number.isInteger(b.limit), `${b.name}.limit 应为整数`).toBe(true);
      expect(b.limit, `${b.name}.limit 应为正数`).toBeGreaterThan(0);
      expect(Number.isInteger(b.windowSec), `${b.name}.windowSec 应为整数`).toBe(true);
      expect(b.windowSec, `${b.name}.windowSec 应为正数`).toBeGreaterThan(0);
    }
  });

  it("每个桶的 zh/en 用途说明均非空白", () => {
    for (const b of RATE_BUCKETS) {
      expect(b.zh.trim().length, `${b.name}.zh 说明缺失`).toBeGreaterThan(0);
      expect(b.en.trim().length, `${b.name}.en 说明缺失`).toBeGreaterThan(0);
    }
  });
});

describe("rateLimitBucket · 无覆盖用清单默认值", () => {
  it("getSetting 返回 undefined 时按默认 limit/windowSec 调用 rateLimit", async () => {
    await rateLimitBucket("auth.login", "203.0.113.5");
    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).toHaveBeenCalledWith("auth.login:203.0.113.5", defaults["auth.login"].limit, defaults["auth.login"].windowSec * 1000);
  });

  it("getSetting 返回 null / 空对象同样用默认值", async () => {
    getSettingMock.mockResolvedValue(null);
    await rateLimitBucket("write.post", "user-1");
    expect(rateLimitMock).toHaveBeenCalledWith("write.post:user-1", defaults["write.post"].limit, defaults["write.post"].windowSec * 1000);

    getSettingMock.mockResolvedValue({});
    await rateLimitBucket("write.comment", "user-1");
    expect(rateLimitMock).toHaveBeenCalledWith("write.comment:user-1", defaults["write.comment"].limit, defaults["write.comment"].windowSec * 1000);
  });

  it("覆盖里只出现其它桶时，本桶不受影响", async () => {
    getSettingMock.mockResolvedValue({ "write.post": { limit: 1, windowSec: 1 } });
    await rateLimitBucket("message.send", "user-9");
    expect(rateLimitMock).toHaveBeenCalledWith("message.send:user-9", defaults["message.send"].limit, defaults["message.send"].windowSec * 1000);
  });

  it("覆盖含未知桶名时不影响已知桶", async () => {
    getSettingMock.mockResolvedValue({ "ghost.bucket": { limit: 99, windowSec: 99 } });
    await rateLimitBucket("report.create", "user-2");
    expect(rateLimitMock).toHaveBeenCalledWith("report.create:user-2", defaults["report.create"].limit, defaults["report.create"].windowSec * 1000);
  });
});

describe("rateLimitBucket · 合法覆盖生效", () => {
  it("limit 与 windowSec 均取覆盖值（秒转毫秒）", async () => {
    getSettingMock.mockResolvedValue({ "auth.login": { limit: 3, windowSec: 30 } });
    await rateLimitBucket("auth.login", "1.2.3.4");
    expect(rateLimitMock).toHaveBeenCalledWith("auth.login:1.2.3.4", 3, 30_000);
  });

  it("键拼装为 `${bucket}:${identity}`，identity 含冒号也原样拼接", async () => {
    getSettingMock.mockResolvedValue(undefined);
    await rateLimitBucket("mcp.api", "token:abc:42");
    expect(rateLimitMock.mock.calls[0]?.[0]).toBe("mcp.api:token:abc:42");
  });

  it("不同桶的同一主体互不串号", async () => {
    getSettingMock.mockResolvedValue(undefined);
    await rateLimitBucket("write.post", "user-1");
    await rateLimitBucket("write.comment", "user-1");
    const keys = rateLimitMock.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["write.post:user-1", "write.comment:user-1"]);
  });
});

describe("rateLimitBucket · 坏形状覆盖整条忽略、回落默认", () => {
  const BAD_OVERRIDES: unknown[] = [
    { limit: 999 }, // 缺 windowSec
    { windowSec: 30 }, // 缺 limit
    { limit: 0, windowSec: 30 }, // limit 非正
    { limit: -5, windowSec: 30 }, // limit 负数
    { limit: 1.5, windowSec: 30 }, // limit 非整数
    { limit: 10, windowSec: 0 }, // windowSec 非正
    { limit: 10, windowSec: 60.5 }, // windowSec 非整数
    { limit: "10", windowSec: 30 }, // 字符串数字
    { limit: null, windowSec: 30 },
    "10/30", // 完全不是对象
    42,
    null,
  ];

  it("各种坏形状均回落桶默认（绝不让坏配置放大阈值）", async () => {
    const base = defaults["write.comment"];
    for (const bad of BAD_OVERRIDES) {
      rateLimitMock.mockClear();
      getSettingMock.mockResolvedValue({ "write.comment": bad });
      await rateLimitBucket("write.comment", "user-bad");
      expect(rateLimitMock).toHaveBeenCalledWith(
        "write.comment:user-bad",
        base.limit,
        base.windowSec * 1000,
      );
    }
  });
});

describe("调用点桶名与清单对账", () => {
  // 未知桶名在运行时是 BUCKET_MAP[name] === undefined → 读 limit 抛 TypeError，
  // 表现为该路由 500（限流形同未接入且击穿请求）。类型层靠 BucketName 约束，
  // 但 `as` 断言、跨文件复制粘贴与字符串常量都会绕过，故用静态扫描兜底。
  const SRC = fileURLToPath(new URL("../../", import.meta.url));

  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) yield p;
    }
  }

  it("每个 rateLimitBucket 字面量桶名都在清单中声明", () => {
    const declared = new Set<string>(RATE_BUCKETS.map((b) => b.name));
    const orphans: string[] = [];
    const used = new Set<string>();
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/rateLimitBucket\(\s*"([^"]+)"/g)) {
        used.add(m[1]);
        if (!declared.has(m[1])) orphans.push(`${relative(SRC, file)} → ${m[1]}`);
      }
    }
    expect(orphans, `未声明的桶名：${orphans.join(", ")}`).toEqual([]);
    expect(used.size, "扫描未命中任何调用点，正则可能已失效").toBeGreaterThan(10);
  });
});
