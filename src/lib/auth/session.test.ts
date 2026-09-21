// 被测模块：src/lib/auth/session.ts 中的纯函数（会话绝对寿命 + 滑动续期上限）。
// 依赖 mock：@/db、next/headers（仅满足模块顶层 import，测试不触达）。
// 语义：30d 滑动窗口保留，但续期绝不越过 180d 绝对寿命；超绝对寿命即失效。
import { describe, expect, it, vi } from "vitest";
import { computeSessionSlideTarget, sessionAbsoluteDeadlineMs, sessionLifetimeMs } from "./session";
import { config } from "@/core/config";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const DAY = 86400_000;

describe("sessionAbsoluteDeadlineMs", () => {
  it("absoluteExpiresAt 存在 ⇒ 直接采用", () => {
    const abs = new Date("2026-06-01T00:00:00Z");
    expect(sessionAbsoluteDeadlineMs({ absoluteExpiresAt: abs, createdAt: new Date(0) })).toBe(abs.getTime());
  });

  it("历史行（absoluteExpiresAt=null）⇒ 回落 createdAt + sessionAbsoluteDays", () => {
    const createdAt = new Date(0);
    expect(sessionAbsoluteDeadlineMs({ absoluteExpiresAt: null, createdAt })).toBe(
      config.auth.sessionAbsoluteDays * DAY,
    );
    expect(config.auth.sessionAbsoluteDays).toBe(180); // 公开前收紧的验收值
  });
});

describe("computeSessionSlideTarget", () => {
  const now = Date.UTC(2026, 0, 20);
  const base = {
    nowMs: now,
    expiresAtMs: now + 29 * DAY, // 剩余 29d ≥ 阈值 1d ⇒ 默认不续
    absoluteDeadlineMs: now + 120 * DAY,
    sessionDays: 30,
    thresholdDays: 1,
  };

  it("剩余寿命充足（≥阈值）⇒ 不写库（null）", () => {
    expect(computeSessionSlideTarget(base)).toBeNull();
  });

  it("剩余寿命低于阈值且距绝对上限尚远 ⇒ 顺延至完整 sessionDays", () => {
    const target = computeSessionSlideTarget({ ...base, expiresAtMs: now + DAY - 1 });
    expect(target).toBe(now + 30 * DAY);
  });

  it("滑动续期被绝对寿命封顶（min(now+30d, absolute)）", () => {
    const target = computeSessionSlideTarget({
      ...base,
      expiresAtMs: now + DAY - 1, // 剩 <1d，触发续期
      absoluteDeadlineMs: now + 5 * DAY, // 但绝对上限只剩 5d
    });
    expect(target).toBe(now + 5 * DAY);
  });

  it("已贴着绝对上限（续无可续）⇒ 不再写库", () => {
    expect(
      computeSessionSlideTarget({
        ...base,
        expiresAtMs: now + 3 * DAY,
        absoluteDeadlineMs: now + 3 * DAY,
      }),
    ).toBeNull();
  });

  it("绝对寿命已穿过当前时刻（续期目标不超过现值）⇒ null（getAuth 侧另有硬门槛）", () => {
    expect(
      computeSessionSlideTarget({
        ...base,
        expiresAtMs: now + DAY - 1,
        absoluteDeadlineMs: now - 1,
      }),
    ).toBeNull();
  });

  it("半认证会话（expires/absolute 同为 15 分钟）⇒ 滑动续期救不活它", () => {
    // createSession(pending2fa) 把两条寿命线压到同一时刻；此处按该形状喂入：
    // 目标 = min(now+30d, 15 分钟后) = 15 分钟后 = 现值 ⇒ 不写库，票据准时作废
    const pendingNow = now;
    const pendingExpires = pendingNow + 15 * 60_000;
    expect(
      computeSessionSlideTarget({
        nowMs: pendingNow + 60_000, // 半认证会话已消耗 1 分钟
        expiresAtMs: pendingExpires,
        absoluteDeadlineMs: pendingExpires,
        sessionDays: 30,
        thresholdDays: 1,
      }),
    ).toBeNull();
  });
});

describe("sessionLifetimeMs · 半认证会话生命周期", () => {
  it("pending2fa ⇒ 滑动/绝对同为 15 分钟硬封顶（不给第二因子爆破留长窗口）", () => {
    expect(sessionLifetimeMs(true)).toEqual({ slidingMs: 15 * 60_000, absoluteMs: 15 * 60_000 });
  });

  it("第二因子通过 ⇒ 换发完整 30d 滑动 + 180d 绝对寿命", () => {
    expect(sessionLifetimeMs(false)).toEqual({
      slidingMs: config.auth.sessionDays * DAY,
      absoluteMs: config.auth.sessionAbsoluteDays * DAY,
    });
  });

  it("半认证寿命严格短于完整会话（升格只发生在 setSessionPending2fa(false)）", () => {
    expect(sessionLifetimeMs(true).absoluteMs).toBeLessThan(sessionLifetimeMs(false).absoluteMs);
  });
});
