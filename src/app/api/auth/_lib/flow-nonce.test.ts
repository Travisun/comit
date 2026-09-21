// 被测模块：src/app/api/auth/_lib/flow-nonce.ts（联邦登录流程票据的服务端单次消费登记）。
// 依赖 mock：@/lib/auth/one-time —— 换成可编程的内存键存储（风格对照
// src/lib/auth/passkey.test.ts），本套用例绝不触网/触库。
// 关键语义：签发后首次消费成功、第二次消费判重放；键位不落原文（泄露键空间
// 不等于泄露可用票据）；不同用途互不串号。
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/auth/one-time", () => ({
  issueOneTimeKey: async (key: string, ttlSec: number) => {
    store.set(key, Date.now() + ttlSec * 1000);
  },
  consumeOneTimeKey: async (key: string) => {
    const exp = store.get(key);
    if (exp === undefined) return false;
    store.delete(key); // 原子消费：命中即移除
    return exp > Date.now();
  },
}));

import { consumeFlowParam, issueFlowParam } from "./flow-nonce";
import { sha256 } from "@/lib/auth/password";

beforeEach(() => {
  store.clear();
});

describe("issueFlowParam / consumeFlowParam · 回调防重放", () => {
  it("签发后首次消费 true、第二次 false（同一 state/nonce 打两次 ⇒ 第二次拒）", async () => {
    const state = "abc123state";
    await issueFlowParam("oauth_state", state);
    await expect(consumeFlowParam("oauth_state", state)).resolves.toBe(true);
    await expect(consumeFlowParam("oauth_state", state)).resolves.toBe(false);
  });

  it("未签发过的票据 ⇒ 直接判重放（不接受调用方自带的 state/nonce）", async () => {
    await expect(consumeFlowParam("sso_nonce", "never-issued")).resolves.toBe(false);
  });

  it("键位用哈希而非原文：键空间被读到也不泄露仍有效的登录票据", async () => {
    const state = "super-secret-state";
    await issueFlowParam("oauth_state", state);
    const [key] = [...store.keys()];
    expect(key).toContain(sha256(state));
    expect(key).not.toContain(state);
    expect(key.startsWith("mb:otc:oauth_state:")).toBe(true);
  });

  it("用途隔离：同值的 oauth_state 与 sso_nonce 互不消费（跨流程重放被封）", async () => {
    const value = "same-value-across-flows";
    await issueFlowParam("oauth_state", value);
    await expect(consumeFlowParam("sso_nonce", value)).resolves.toBe(false);
    await expect(consumeFlowParam("oauth_state", value)).resolves.toBe(true);
  });

  it("TTL 与承载 cookie 等长（600s）：过期窗口一致，不出现「cookie 已死、键还活」", async () => {
    const value = "ttl-check";
    await issueFlowParam("oauth_state", value);
    const [, expiresAtMs] = [...store.entries()][0];
    const ttlSec = (expiresAtMs - Date.now()) / 1000;
    expect(ttlSec).toBeGreaterThan(590);
    expect(ttlSec).toBeLessThanOrEqual(600);
  });
});
