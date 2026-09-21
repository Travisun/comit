// 被测模块：src/app/api/auth/_lib/federated.ts（联邦登录 find-or-create，公开前
// 账户接管加固）。依赖 mock：@/db（步骤队列驱动的 thenable 链）、@/lib/users、
// @/core/events —— 全程无真实 DB。核心断言：仅 (provider, providerAccountId)
// 精确命中才自动登入；纯邮箱命中一律拒绝并要求去设置页主动绑定；未验证邮箱
// 拒绝自动注册。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FederatedProfile } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "./federated";
import { assertUsernameAvailable } from "@/lib/users";
import { emit } from "@/core/events";

/** 步骤队列：每个被 await 的 drizzle 链按序弹出一个结果（Error ⇒ 模拟抛错） */
const state = vi.hoisted(() => ({ steps: [] as Array<unknown | Error> }));

vi.mock("@/db", () => {
  const makeChain = () => {
    const then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      const step = state.steps.shift();
      if (step instanceof Error) {
        const err = step;
        if (rej) rej(err);
        return Promise.reject(err);
      }
      return Promise.resolve(step ?? []).then(res);
    };
    const chain: unknown = new Proxy(function () {}, {
      apply: () => chain,
      get: (_t, prop) => (prop === "then" ? then : chain),
    });
    return chain;
  };
  return {
    db: new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "select" || prop === "insert" || prop === "update" || prop === "delete"
            ? makeChain()
            : undefined,
      },
    ),
  };
});

vi.mock("@/lib/users", () => ({ assertUsernameAvailable: vi.fn(async () => undefined) }));
vi.mock("@/core/events", () => ({ emit: vi.fn(async () => undefined) }));

const userRow = (over: Record<string, unknown> = {}) => ({
  id: "u-1",
  email: "victim@example.com",
  username: "victim",
  displayName: "Victim",
  status: "active",
  ...over,
});

const profile = (over: Partial<FederatedProfile> = {}): FederatedProfile => ({
  provider: "github",
  providerAccountId: "gh-42",
  email: "Victim@Example.com",
  displayName: "GH User",
  emailVerified: true,
  ...over,
});

beforeEach(() => {
  state.steps = [];
  vi.mocked(assertUsernameAvailable).mockClear();
  vi.mocked(emit).mockClear();
});

describe("findOrCreateFederatedUser · 自动登入唯一通道 = provider 精确命中", () => {
  it("已存在的 (provider, providerAccountId) 链接 → 直接登入，不注册不写库", async () => {
    state.steps.push([{ userId: "u-1" }], [userRow()]);
    const res = await findOrCreateFederatedUser(profile());
    expect(res.created).toBe(false);
    expect(res.user.id).toBe("u-1");
    expect(emit).not.toHaveBeenCalled();
    expect(state.steps).toHaveLength(0);
  });

  it("provider 已命中但用户已注销 → 落入邮箱分支并报 oauth_deleted", async () => {
    // 链接命中 → 按 id 取出已注销用户（继续）→ 邮箱查询命中同一注销行 → 抛错
    state.steps.push([{ userId: "u-1" }], [userRow({ status: "deleted" })], [userRow({ status: "deleted" })]);
    await expect(findOrCreateFederatedUser(profile())).rejects.toMatchObject({ code: "oauth_deleted" });
  });
});

describe("findOrCreateFederatedUser · 陌生 provider 邮箱命中 ⇒ 拒绝自动登入", () => {
  it("即使 provider 邮箱已验证，也不自动绑定/登入，要求登录后去设置绑定", async () => {
    state.steps.push([], [userRow()]); // 无链接；邮箱命中既有账户
    await expect(findOrCreateFederatedUser(profile({ emailVerified: true }))).rejects.toMatchObject({
      code: "oauth_email_registered",
      status: 409,
    });
    // 关键：没有任何绑定/注册写入 —— 队列只剩既有账户查询后的空位
    expect(emit).not.toHaveBeenCalled();
  });

  it("错误文案含「登录 + 设置绑定」指引", async () => {
    state.steps.push([], [userRow()]);
    const err = await findOrCreateFederatedUser(profile()).catch((e) => e);
    expect(String(err.message)).toContain("设置");
    expect(String(err.message)).toMatch(/已被注册|already registered/);
  });

  it("邮箱命中的账户已注销 → oauth_deleted（而非误导去绑定）", async () => {
    state.steps.push([], [userRow({ status: "deleted" })]);
    await expect(findOrCreateFederatedUser(profile())).rejects.toMatchObject({ code: "oauth_deleted" });
  });

  it("未验证邮箱撞上既有账户 → 同样是 oauth_email_registered（不泄露更多）", async () => {
    state.steps.push([], [userRow()]);
    await expect(findOrCreateFederatedUser(profile({ emailVerified: false }))).rejects.toMatchObject({
      code: "oauth_email_registered",
    });
  });
});

describe("findOrCreateFederatedUser · 自动注册门槛", () => {
  const registerSteps = () => {
    // 链接查询空 → 邮箱查询空 → 注册 insert returning → oauthAccounts 落行
    state.steps.push([], [], [userRow({ id: "new-1", status: "active" })], []);
  };

  it("全新邮箱 + provider 已验证 → 自动注册（emailVerifiedAt 保持 null 走站内验证）", async () => {
    registerSteps();
    const res = await findOrCreateFederatedUser(profile());
    expect(res.created).toBe(true);
    expect(res.user.id).toBe("new-1");
    expect(emit).toHaveBeenCalledWith("user:registered", expect.objectContaining({ userId: "new-1" }));
  });

  it("email_verified=false（非合成）→ 拒绝自动注册，不落任何写入", async () => {
    state.steps.push([], []);
    await expect(findOrCreateFederatedUser(profile({ emailVerified: false }))).rejects.toMatchObject({
      code: "oauth_email_unverified",
    });
    expect(emit).not.toHaveBeenCalled();
    expect(state.steps).toHaveLength(0); // 只有两次查询，之后无写入
  });

  it("email_verified 缺失（undefined）→ 同样拒绝自动注册", async () => {
    state.steps.push([], []);
    await expect(
      findOrCreateFederatedUser(profile({ emailVerified: undefined })),
    ).rejects.toMatchObject({ code: "oauth_email_unverified" });
  });

  it("X 合成 noreply 邮箱（身份由 provider 证明）→ 允许注册，但绝不按邮箱绑入既有账户", async () => {
    registerSteps();
    const res = await findOrCreateFederatedUser(
      profile({
        provider: "x",
        providerAccountId: "x-1",
        email: "handle@users.noreply.x.com",
        emailVerified: false,
        emailSynthetic: true,
      }),
    );
    expect(res.created).toBe(true);
  });

  it("provider 未返回邮箱 → oauth_no_email", async () => {
    await expect(findOrCreateFederatedUser(profile({ email: "   " }))).rejects.toMatchObject({
      code: "oauth_no_email",
    });
  });
});
