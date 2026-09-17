import { describe, expect, it } from "vitest";
import { gatePluginContext, PLUGIN_CAPABILITY_KEYS } from "./gate";
import { bus } from "@/core/events";
import type { PluginContext } from "./types";

/** 权限门控回归：未声明能力的访问必须被拒绝并携带扩展 id。 */
const fakeCtx = { events: bus, llm: {}, cron: {}, flags: {} } as unknown as PluginContext;

describe("gatePluginContext", () => {
  it("未声明 permissions → 全量信任（内置扩展零改动）", () => {
    const ctx = gatePluginContext(fakeCtx, undefined, "test");
    expect(ctx.events).toBe(bus);
    expect(ctx.llm).toBeDefined();
  });

  it("声明 events → events 可用", () => {
    const ctx = gatePluginContext(fakeCtx, ["events"], "test");
    expect(ctx.events).toBe(bus);
  });

  it("未声明的能力访问即抛错（含扩展 id）", () => {
    const ctx = gatePluginContext(fakeCtx, ["events"], "test-ext");
    // ctx.llm 是拒绝存根 Proxy —— 调用其方法时抛错
    expect(() => (ctx as unknown as Record<string, unknown>).llm).not.toThrow(); // 取到存根本身不抛
    expect(() => ((ctx as unknown as Record<string, unknown>).llm as { listModels(): void }).listModels()).toThrow(/test-ext.*llm/);
    expect(() => ((ctx as unknown as Record<string, unknown>).cron as { register(): void }).register()).toThrow(/test-ext.*cron/);
  });

  it("拒绝存根不可被属性枚举绕过", () => {
    const ctx = gatePluginContext(fakeCtx, ["events"], "x");
    expect(() => JSON.parse(JSON.stringify((ctx as unknown as Record<string, unknown>).jobs))).toThrow();
  });

  it("能力键清单覆盖 PluginContext 全部顶层字段", () => {
    // 防漂移哨兵：types.ts 新增能力时必须同步 PLUGIN_CAPABILITY_KEYS
    expect(PLUGIN_CAPABILITY_KEYS).toContain("events");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("jobs");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("notifications");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("llm");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("broadcast");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("search");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("middleware");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("flags");
    expect(PLUGIN_CAPABILITY_KEYS).toContain("seeds");
  });
});
