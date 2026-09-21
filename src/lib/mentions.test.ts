// 被测模块：src/lib/mentions —— 稳定引用语法的展开（渲染）与还原（编辑器）。
// 回归重点：生产格式是 `@[昵称](mention:uuid)`（@ 在括号外）——消费端正则
// 一旦写成 \[@…\] 就永远不命中，UI 直显原始语法（曾在评论区/正文出现）。
import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // 每次调用返回新数组：processMentions 会对两次查询的结果做
        // `for (const r of byName) resolved.push(r)`，同对象会自迭代爆栈
        where: async () => rows.current.map((r) => ({ ...(r as object) })),
      }),
    }),
  },
}));

const { expandMentionTokens, flattenMentionTokens, processMentions } = await import("./mentions");

const UID = "345e139d-ad67-4469-83c3-f71e580ac548";

describe("expandMentionTokens", () => {
  it("展开规范存储形态 @[昵称](mention:id) 为最新昵称资料页链接", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    expect(await expandMentionTokens(`加油 @[旧的名字](mention:${UID})！`)).toBe(
      "加油 [@Rui](/u/rui)！",
    );
  });

  it("查无此用户时降级为 @昵称 纯文本（不留原始语法）", async () => {
    rows.current = [];
    expect(await expandMentionTokens(`hi @[张三](mention:${UID})`)).toBe("hi @张三");
  });

  it("同一 token 内多次出现全部展开；无 token 文本原样返回", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    const twice = `@[Rui](mention:${UID}) 和 @[Rui](mention:${UID})`;
    expect(await expandMentionTokens(twice)).toBe("[@Rui](/u/rui) 和 [@Rui](/u/rui)");
    expect(await expandMentionTokens("普通文本 @not-a-token")).toBe("普通文本 @not-a-token");
  });

  it("昵称自带 ] 时仍识别 token，并降级为纯文本（不产出断链、不漏原始语法）", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "a]b" }];
    expect(await expandMentionTokens(`嗨 @[a]b](mention:${UID})`)).toBe("嗨 @a]b");
  });

  it("未闭合的 @[ 长文本不被回溯吞掉（有界惰性 → 原样返回）", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    const junk = "@[" + "x".repeat(5000);
    expect(await expandMentionTokens(junk)).toBe(junk);
  });
});

describe("flattenMentionTokens（编辑器预填）", () => {
  it("还原为 @用户名：昵称已改也不影响回写命中", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "改了的名字" }];
    expect(await flattenMentionTokens(`加油 @[旧的名字](mention:${UID})！`)).toBe("加油 @rui！");
  });

  it("编辑往返幂等：展开前的库内文本 → flatten → 再保存落回同一条稳定引用", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    const draft = await flattenMentionTokens("加油 @[Rui](mention:" + UID + ")！");
    const resaved = await processMentions(draft, "author-1");
    expect(resaved.text).toBe("加油 @[Rui](mention:" + UID + ")！");
    expect(resaved.mentionedUserIds).toEqual([UID]);
  });
});
