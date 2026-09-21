// 被测模块：src/lib/storage/local.ts —— storage-root 包含校验。
// 导出打包等上层入口的 key 来自用户可控正文，逃逸键必须在驱动层被拒绝。
import { describe, expect, it, vi } from "vitest";
import { localRead, localExists, localDelete } from "./local";

vi.mock("server-only", () => ({}));

describe("local · storage-root 包含校验", () => {
  it.each([
    "../../package.json",
    "ab/cd/../../../../etc/passwd",
    "/etc/passwd",
    "..",
  ])("逃逸键一律拒绝：%s", async (key) => {
    await expect(localRead(key)).rejects.toThrow(/invalid storage key/);
    await localDelete(key); // 静默容忍，不抛
    await expect(localExists(key)).resolves.toBe(false);
  });

  it("正常形状键不因校验误伤（不存在的文件报 ENOENT）", async () => {
    await expect(
      localRead("ab/cd/00000000-0000-0000-0000-000000000000/nope.webp"),
    ).rejects.toThrow(/ENOENT/);
  });
});
