import { describe, expect, it } from "vitest";
import { coerceExtSettings, type ExtensionManifest } from "./manifest";

/**
 * 扩展设置项权限契约的安全基线：
 * coerceExtSettings 是用户级设置写入（PUT /api/me/ext/<id>/settings）的唯一
 * 收敛点 —— 任何绕过前端表单的直接构造请求都不能写入未声明键、非法枚举值、
 * 超长文本或错误类型。
 */

const manifest = {
  id: "test",
  title: { zh: "测试", en: "Test" },
  version: "1.0.0",
  settingsFields: [
    { key: "enabled", type: "boolean", label: "启用", default: false },
    {
      key: "mode",
      type: "select",
      label: "模式",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    { key: "note", type: "text", label: "备注", maxLength: 10 },
    { key: "count", type: "number", label: "数量", default: 1 },
  ],
} satisfies ExtensionManifest;

describe("coerceExtSettings（用户级设置白名单收敛）", () => {
  it("丢弃未声明的键（注入/篡改面收口）", () => {
    const out = coerceExtSettings(manifest, {
      enabled: true,
      evil: "<script>",
      "ext.other.key": "cross-namespace",
    });
    expect(out).toEqual({ enabled: true, mode: "a", note: "", count: 1 });
    expect("evil" in out).toBe(false);
  });

  it("select/radio 只接受已注册选项，非法值回落首个选项", () => {
    const out = coerceExtSettings(manifest, { mode: "INJECTED" });
    expect(out.mode).toBe("a");
  });

  it("boolean 类型不符回落默认值（字符串 'true' 不被接受）", () => {
    expect(coerceExtSettings(manifest, { enabled: "true" }).enabled).toBe(false);
    expect(coerceExtSettings(manifest, { enabled: true }).enabled).toBe(true);
  });

  it("文本按 maxLength 截断、空白回落默认", () => {
    expect(coerceExtSettings(manifest, { note: "0123456789ABCDEF" }).note).toHaveLength(10);
    expect(coerceExtSettings(manifest, { note: "   " }).note).toBe("");
  });

  it("number 非数值回落默认（NaN/Infinity 拒绝）", () => {
    expect(coerceExtSettings(manifest, { count: "abc" }).count).toBe(1);
    expect(coerceExtSettings(manifest, { count: "Infinity" }).count).toBe(1);
    expect(coerceExtSettings(manifest, { count: 7 }).count).toBe(7);
  });

  it("非对象输入整体回落默认", () => {
    expect(coerceExtSettings(manifest, null)).toEqual({
      enabled: false,
      mode: "a",
      note: "",
      count: 1,
    });
    expect(coerceExtSettings(manifest, "string").enabled).toBe(false);
  });

  it("无 settingsFields 的扩展收敛为空对象（前台不展示、端点 404）", () => {
    const bare = { id: "bare", title: { zh: "裸", en: "Bare" }, version: "1.0.0" } satisfies ExtensionManifest;
    expect(coerceExtSettings(bare, { anything: 1 })).toEqual({});
  });
});
