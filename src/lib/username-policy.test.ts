import { describe, expect, it } from "vitest";
import {
  RESERVED_USERNAMES,
  checkUsernameFormat,
  isValidUsername,
} from "@/lib/username-policy";

/**
 * 用户名策略（单一来源）回归：注册/OAuth 口径与 proxy 重写正则的字符集
 * 必须一致 —— 历史缺陷是 proxy 不认连字符，OAuth 生成的 john-doe 类用户名
 * 规范地址永久 404；「sub」可注册但 /sub 被 proxy 保留导致路由遮蔽。
 */
describe("isValidUsername（注册/OAuth 口径）", () => {
  it("允许字母/数字/下划线/连字符组合", () => {
    expect(isValidUsername("john-doe")).toBe(true);
    expect(isValidUsername("john_doe")).toBe(true);
    expect(isValidUsername("user01")).toBe(true);
    expect(isValidUsername("1abc")).toBe(true); // 注册口径允许数字开头（OAuth 机械生成）
  });

  it("拒绝分隔符结尾（外观一致性）", () => {
    expect(isValidUsername("john-")).toBe(false);
    expect(isValidUsername("john_")).toBe(false);
    expect(isValidUsername("-john")).toBe(false);
  });

  it("长度边界 2–63", () => {
    expect(isValidUsername("ab")).toBe(true);
    expect(isValidUsername("a")).toBe(false);
    expect(isValidUsername("a".repeat(63))).toBe(true);
    expect(isValidUsername("a".repeat(64))).toBe(false);
  });

  it("保留字（含历史上被 proxy 遮蔽的 sub / 扩展路由 e）不可注册", () => {
    expect(isValidUsername("sub")).toBe(false);
    expect(RESERVED_USERNAMES.has("sub")).toBe(true);
    expect(RESERVED_USERNAMES.has("e")).toBe(true);
    expect(isValidUsername("admin")).toBe(false);
  });

  it("大写与非合法字符拒绝（输入应已小写化）", () => {
    expect(isValidUsername("John")).toBe(false);
    expect(isValidUsername("jo hn")).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });
});

describe("checkUsernameFormat（改名口径，比注册严格）", () => {
  it("5–35 字符、字母开头、无下划线结尾", () => {
    expect(checkUsernameFormat("alice").ok).toBe(true);
    expect(checkUsernameFormat("abcd").ok).toBe(false); // < 5
    expect(checkUsernameFormat("1abcd").ok).toBe(false); // 数字开头
    expect(checkUsernameFormat("abcd_").ok).toBe(false); // 下划线结尾
  });

  it("连字符不在改名口径内（历史存量名字不受影响，仅限制新改名）", () => {
    expect(checkUsernameFormat("john-doe").ok).toBe(false);
  });

  it("保留字与大写输入", () => {
    expect(checkUsernameFormat("Sub").ok).toBe(false);
    expect(checkUsernameFormat("alice01").ok).toBe(true);
  });
});
