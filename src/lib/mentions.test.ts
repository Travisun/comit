// 被测模块：src/lib/mentions —— 稳定引用语法的展开（渲染）与还原（编辑器）。
// 回归重点：生产格式是 `@[昵称](mention:uuid)`（@ 在括号外）——消费端正则
// 一旦写成 \[@…\] 就永远不命中，UI 直显原始语法（曾在评论区/正文出现）。
import { describe, expect, it, vi } from "vitest";
import { makeExcerpt, markdownToPlain, truncate } from "@/lib/utils";
import {
  mentionSyntaxToPlainText,
  mentionTokenRe,
  parseInlineSegments,
} from "./mention-syntax";

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

const { expandMentionTokens, flattenMentionTokens, mentionTokensToPlainText, processMentions } =
  await import("./mentions");

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

describe("processMentions · 折叠裁定权", () => {
  // SQL 预筛（lower(displayName)）与 JS 折叠是两套规则，命中集可能比真实命中更宽。
  // 若由 SQL 结果决定「谁被 @ 了」，就会出现「落了通知、正文里却没有链接」的分裂。
  it("大小写不同的用户名仍命中（JS 折叠为准）", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    const res = await processMentions("hi @RUI 加油", "author-1");
    expect(res.text).toBe(`hi @[Rui](mention:${UID}) 加油`);
    expect(res.mentionedUserIds).toEqual([UID]);
  });

  it("预筛多返回的行不产生提及：既不重写正文也不进 mentionedUserIds", async () => {
    rows.current = [{ id: UID, username: "rui", displayName: "Rui" }];
    const res = await processMentions("@rui 和 @unrelated", "author-1");
    expect(res.text).toBe(`@[Rui](mention:${UID}) 和 @unrelated`);
    expect(res.mentionedUserIds).toEqual([UID]);
  });

  it("查无此人时文本原样返回（不写出坏引用）", async () => {
    rows.current = [];
    const res = await processMentions("hello @ghost", "author-1");
    expect(res.text).toBe("hello @ghost");
    expect(res.mentionedUserIds).toEqual([]);
  });
});

/** 与 extensions/notifications 的 truncateText 同形（该模块 server-only + 依赖
 *  DB，node 测试里不可导入，故在此复刻其唯一的空白折叠 + 截断行为）。 */
function noticeTruncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 各纯文本出口在源码里的处理链（顺序即线上顺序：先拉平、后截断/归一）。 */
const PLAIN_TEXT_OUTLETS: [string, (t: string) => string | Promise<string>][] = [
  ["站内通知正文（评论被喜欢 / 被设为解决方案）", async (t) => noticeTruncate(await mentionTokensToPlainText(t))],
  ["邮件摘要（mail 渠道兜底）", (t) => mentionSyntaxToPlainText(t)],
  ["后台评论表格", async (t) => truncate(await mentionTokensToPlainText(t), 100)],
  ["举报对象预览", async (t) => truncate(await mentionTokensToPlainText(t), 300)],
  ["审核台正文预览", async (t) => truncate(await mentionTokensToPlainText(t), 500)],
  ["审核模型输入", async (t) => markdownToPlain(await mentionTokensToPlainText(t))],
  ["MCP 正文 / 评论输出", async (t) => mentionTokensToPlainText(t)],
  ["站内通知气泡（修复前落库的历史行）", (t) => mentionSyntaxToPlainText(t)],
  ["事件摘要（emit → 通知正文，makeExcerpt 口径）", (t) => makeExcerpt(t, 120)],
];

describe("纯文本出口不变量", () => {
  const raw = `大家看看 @[武林高萝卜](mention:${UID}) 的这条评论：写得真好`;

  it.each(PLAIN_TEXT_OUTLETS)("%s：无引用语法、无链接语法残留", async (_name, run) => {
    rows.current = [{ id: UID, username: "yohan", displayName: "武林高萝卜" }];
    const out = await run(raw);
    expect(out).not.toContain("](mention:");
    expect(out).not.toContain("](");
    expect(out).toContain("@武林高萝卜");
  });

  it("帖子摘要既有口径同样安全（makeExcerpt 会把语法降成文本）", () => {
    expect(makeExcerpt(raw, 500)).not.toContain("](");
  });

  // makeExcerpt/markdownToPlain 还是「评论事件摘要 → 通知正文」「举报对象帖子预览」
  // 「文章 summary」的出口：昵称自带 `]` 时通用 markdown 链接规则失效，
  // 必须由同源正则先拉平（utils.markdownToPlain 已接上）。
  it("昵称自带 ] 时 makeExcerpt 口径同样不漏语法", () => {
    const nasty = `看 @[a]b](mention:${UID}) 的评论`;
    expect(makeExcerpt(nasty, 500)).toBe("看 @a]b 的评论");
    expect(markdownToPlain(nasty)).not.toContain("](mention:");
    expect(markdownToPlain(nasty)).not.toContain("](");
  });

  it.each([10, 12, 16, 20, 24, 30])(
    "截断长度 %i 也不漏语法（拉平恒在截断之前）",
    async (max) => {
      rows.current = [{ id: UID, username: "yohan", displayName: "武林高萝卜" }];
      expect(truncate(await mentionTokensToPlainText(raw), max)).not.toMatch(/\]\(/);
    },
  );

  it("反例：先截断后拉平会把引用语法切成字面量（故顺序不可反）", () => {
    // 截点落在 `mention:` 内部时，token 正则不再命中 → 半截语法原样留在纯文本里
    expect(mentionSyntaxToPlainText(truncate(raw, 20))).toMatch(/\]\(/);
  });

  it("提及已注销用户时纯文本出口同样只留 @昵称", async () => {
    rows.current = [];
    expect(await mentionTokensToPlainText(raw)).toBe("大家看看 @武林高萝卜 的这条评论：写得真好");
    expect(parseInlineSegments(await mentionTokensToPlainText(raw))).toEqual([
      { type: "text", text: "大家看看 @武林高萝卜 的这条评论：写得真好" },
    ]);
  });
});

describe("生产端与消费端正则同源", () => {
  it("processMentions 产物必被 mentionTokenRe 命中，展开产物必被行内分词识别为链接", async () => {
    rows.current = [{ id: UID, username: "yohan", displayName: "武林高萝卜" }];
    const produced = (await processMentions("你好 @yohan，看看", "author-1")).text;
    expect(produced).toBe(`你好 @[武林高萝卜](mention:${UID})，看看`);
    expect([...produced.matchAll(mentionTokenRe())].map((m) => m.groups?.mentionId)).toEqual([UID]);

    const expanded = await expandMentionTokens(produced);
    expect(expanded).toBe("你好 [@武林高萝卜](/u/yohan)，看看");
    expect(parseInlineSegments(expanded)).toEqual([
      { type: "text", text: "你好 " },
      { type: "link", text: "@武林高萝卜", href: "/u/yohan" },
      { type: "text", text: "，看看" },
    ]);
  });
});
