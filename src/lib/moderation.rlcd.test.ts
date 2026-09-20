import { describe, expect, it } from "vitest";
import type { LlmLogprobToken } from "@/lib/llm";
import { extractViolationProbability, normalizeRlcdReview } from "@/lib/moderation";

/** 构造 logprobs 片段（模拟 llama-server 返回的 true/false 候选） */
function lp(trueLp: number, falseLp: number): LlmLogprobToken[] {
  return [
    { token: "{", logprob: 0, topLogprobs: [] },
    {
      token: "true",
      logprob: trueLp,
      topLogprobs: [
        { token: "true", logprob: trueLp },
        { token: "false", logprob: falseLp },
      ],
    },
  ];
}

describe("extractViolationProbability", () => {
  it("在 true/false 候选上做子集 softmax", () => {
    // -0.16 vs -3.28 → P(true)≈0.958（与 Python 端一致）
    const p = extractViolationProbability(lp(-0.16, -3.28));
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.95);
    expect(p!).toBeLessThan(0.97);
  });

  it("缺失候选时返回 null（回退到 violation 布尔值）", () => {
    expect(extractViolationProbability(undefined)).toBeNull();
    expect(
      extractViolationProbability([{ token: "x", logprob: 0, topLogprobs: [] }]),
    ).toBeNull();
  });
});

describe("normalizeRlcdReview（v7.3 处置路由）", () => {
  it("语气句：模型误判 abuse 但无词表证据 → human_review，绝不 auto_reject", () => {
    const r = normalizeRlcdReview(
      { violation: true, category: "abuse", severity: "high", reason: "辱骂" },
      "你到底，你说啥？",
      0.93,
    );
    expect(r?.action).toBe("human_review");
    expect(r?.approved).toBe(false);
    expect(r?.pViolation).toBe(0.93);
  });

  it("诈骗黑话：交易型类别 + P≥0.95 + 词表命中 → auto_reject", () => {
    const r = normalizeRlcdReview(
      { violation: true, category: "fraud", severity: "high", reason: "刷单诈骗话术" },
      "加薇 xxx88 每天稳定500，导师一对一带你做任务，日结秒到",
      0.999,
    );
    expect(r?.action).toBe("auto_reject");
    expect(r?.approved).toBe(false);
  });

  it("警方通报：命中 fraud 词表但触发通报语境阻断 → human_review", () => {
    const r = normalizeRlcdReview(
      { violation: true, category: "fraud", severity: "high", reason: "涉刷单" },
      "警方通报：近日破获一起网络刷单诈骗案，提醒群众切勿轻信",
      0.99,
    );
    expect(r?.action).toBe("human_review");
  });

  it("解读型类别（violence）即使 P 很高也不自动拒绝", () => {
    const r = normalizeRlcdReview(
      { violation: true, category: "violence", severity: "high", reason: "血腥" },
      "游戏测评：团战场面相当血腥刺激",
      0.98,
    );
    expect(r?.action).toBe("human_review");
  });

  it("模型放行但词表命中（翻墙黑话盲区）→ human_review 兜底", () => {
    const r = normalizeRlcdReview(
      { violation: false, category: "normal", severity: "none", reason: "未命中" },
      "免费梯子自取，亲测能看外网",
      0.01,
    );
    expect(r?.action).toBe("human_review");
  });

  it("模型放行且无词表命中 → auto_pass", () => {
    const r = normalizeRlcdReview(
      { violation: false, category: "normal", severity: "none", reason: "正常交流" },
      "我来试试吧。",
      0.002,
    );
    expect(r?.action).toBe("auto_pass");
    expect(r?.approved).toBe(true);
  });

  it("灰区：交易型类别但 P 不足 → human_review", () => {
    const r = normalizeRlcdReview(
      { violation: true, category: "fraud", severity: "medium", reason: "疑似" },
      "加薇 xxx88 每天稳定500",
      0.68,
    );
    expect(r?.action).toBe("human_review");
  });

  it("非法形状返回 null（回退旧版解析）", () => {
    expect(normalizeRlcdReview({ approved: true }, "x", 0)).toBeNull();
  });
});
