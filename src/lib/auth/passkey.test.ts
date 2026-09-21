// 被测模块：src/lib/auth/passkey.ts（challenge JWT 一次性消费）。
// 依赖 mock：@/lib/auth/one-time 用内存 Map 模拟三级存储的语义（存在即可消费、
// 消费即删除、过期失效）；@/lib/settings 隔离 DB。验证：签发→消费成功、同一
// cookie 重放返回 replay 状态、缺失/篡改/用途与归属不符返回 missing。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import {
  PASSKEY_CHALLENGE_COOKIE,
  challengeCookie,
  readChallenge,
} from "./passkey";
import { config } from "@/core/config";

const store = vi.hoisted(() => ({ map: new Map<string, number>() }));

vi.mock("@/lib/auth/one-time", () => ({
  issueOneTimeKey: async (key: string, ttlSec: number) => {
    store.map.set(key, Date.now() + ttlSec * 1000);
  },
  consumeOneTimeKey: async (key: string) => {
    const exp = store.map.get(key);
    if (exp === undefined) return false;
    store.map.delete(key);
    return exp > Date.now();
  },
}));

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => "test") }));

const secret = () => new TextEncoder().encode(config.auth.secret);

function requestWithCookie(value: string | null): Request {
  const headers: Record<string, string> = value ? { cookie: `${PASSKEY_CHALLENGE_COOKIE}=${value}` } : {};
  return new Request("http://localhost:3000/api/auth/passkeys/login", { headers });
}

beforeEach(() => {
  store.map.clear();
});

describe("challengeCookie ⇄ readChallenge 一次性闭环", () => {
  it("签发带 jti 的 challenge JWT，首次验证 ok 且取回原 challenge", async () => {
    const cookie = await challengeCookie("pk_login", "chal-abc", null);
    const { payload } = await jwtVerify(cookie.value, secret());
    expect(typeof payload.jti).toBe("string");
    expect((payload.jti ?? "").length).toBeGreaterThan(0);
    expect(payload.chal).toBe("chal-abc");
    expect(cookie.maxAge).toBe(300);

    const res = await readChallenge(requestWithCookie(cookie.value), "pk_login", null);
    expect(res).toEqual({ status: "ok", challenge: "chal-abc" });
  });

  it("同一 cookie TTL 内二次验证 ⇒ replay（重放防护核心语义）", async () => {
    const cookie = await challengeCookie("pk_register", "chal-xyz", "u-1");
    const req = requestWithCookie(cookie.value);
    expect((await readChallenge(req, "pk_register", "u-1")).status).toBe("ok");
    const second = await readChallenge(req, "pk_register", "u-1");
    expect(second.status).toBe("replay");
  });

  it("一次性键被 TTL 淘汰后 ⇒ 不再可消费（过期重放同样拒绝）", async () => {
    const cookie = await challengeCookie("pk_login", "chal-old", null);
    // 直接改写存储层过期时间模拟 TTL 到期（JWT exp 校验由 jose 负责，此处
    // 300s 窗口内仍可解析，只有一次性消费层应拒绝）
    for (const [k, exp] of store.map) store.map.set(k, exp - 600_000);
    const res = await readChallenge(requestWithCookie(cookie.value), "pk_login", null);
    expect(res.status).toBe("replay");
  });

  it("无 cookie / 乱码 cookie ⇒ missing", async () => {
    expect((await readChallenge(requestWithCookie(null), "pk_login", null)).status).toBe("missing");
    expect((await readChallenge(requestWithCookie("not-a-jwt"), "pk_login", null)).status).toBe("missing");
  });

  it("签名合法但用途不符（login cookie 用于 register）⇒ missing 且不消费键", async () => {
    const cookie = await challengeCookie("pk_login", "chal-1", null);
    const res = await readChallenge(requestWithCookie(cookie.value), "pk_register", null);
    expect(res.status).toBe("missing");
    // 键未被消费：正确用途仍可一次消费
    const okRes = await readChallenge(requestWithCookie(cookie.value), "pk_login", null);
    expect(okRes.status).toBe("ok");
  });

  it("归属用户不符 ⇒ missing（register cookie 不能替他人消费）", async () => {
    const cookie = await challengeCookie("pk_register", "chal-2", "u-1");
    const res = await readChallenge(requestWithCookie(cookie.value), "pk_register", "u-2");
    expect(res.status).toBe("missing");
  });

  it("伪造无 jti 的签名 cookie ⇒ missing（无法绕过一次性层）", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ p: "pk_login", uid: null, chal: "fake" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("60s")
      .sign(secret());
    const res = await readChallenge(requestWithCookie(forged), "pk_login", null);
    expect(res.status).toBe("missing");
  });
});
