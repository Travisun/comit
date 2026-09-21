import { SignJWT, jwtVerify } from "jose";
import { config } from "@/core/config";
import { getSetting } from "@/lib/settings";
import { randomToken } from "./password";
import { consumeOneTimeKey, issueOneTimeKey } from "./one-time";

/**
 * WebAuthn 通行密钥（Passkey）服务端助手：
 *  - RP（Relying Party）参数从请求头推导 —— 反代（宝塔 nginx + Cloudflare）后
 *    以 x-forwarded-host / x-forwarded-proto 为准，浏览器侧 origin 与之一致；
 *  - challenge 状态存于 HttpOnly 短时 JWT cookie（5 分钟），API 保持无状态，
 *    不引入服务端会话存储。
 *
 * 重放防护：challenge JWT 携带 jti，签发时向一次性键存储（Redis→PG→内存
 * 三级，见 ./one-time.ts）写入与 jti 绑定的键；验证时原子消费——TTL 内
 * 重复使用同一 cookie（重放）消费失败，返回 replay 状态。
 */

export interface PasskeyRp {
  rpID: string;
  rpName: string;
  origin: string;
}

export async function rpFromRequest(req: Request): Promise<PasskeyRp> {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  // rpID 必须是全站统一的可注册域名（剥 www.）：凭据按 rpID 绑定 —— 若按
  // 请求 host 取，www.comit.sh 与 comit.sh 会产生两套互不可见的凭据
  const canonical = new URL(config.app.url).hostname.replace(/^www\./, "");
  return {
    rpID: canonical,
    rpName: await getSetting("site.name"),
    origin: `${proto}://${host}`,
  };
}

export const PASSKEY_CHALLENGE_COOKIE = "mb_pk_challenge";
const CHALLENGE_TTL_SEC = 300;

function challengeSecret(): Uint8Array {
  return new TextEncoder().encode(config.auth.secret);
}

export type PasskeyChallengePurpose = "pk_register" | "pk_login";

/** 一次性键命名空间（one-time store 层内全局唯一前缀 + jti） */
const ONE_TIME_PREFIX = "mb:otc:pkchal:";

/** 签发 challenge cookie（JWT 载荷携带 challenge + 用途 + 归属用户 + jti）。 */
export async function challengeCookie(
  purpose: PasskeyChallengePurpose,
  challenge: string,
  userId: string | null,
): Promise<{ name: string; value: string; maxAge: number }> {
  const jti = randomToken(16);
  const value = await new SignJWT({ p: purpose, uid: userId, chal: challenge })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(`${CHALLENGE_TTL_SEC}s`)
    .sign(challengeSecret());
  // 一次性消费键与 jti 绑定：TTL 与 cookie 等长，超窗后 JWT 自身 exp 兜底
  await issueOneTimeKey(`${ONE_TIME_PREFIX}${jti}`, CHALLENGE_TTL_SEC);
  return { name: PASSKEY_CHALLENGE_COOKIE, value, maxAge: CHALLENGE_TTL_SEC };
}

export type PasskeyChallengeResult =
  /** challenge 有效且本次调用完成一次性消费 */
  | { status: "ok"; challenge: string }
  /** 无 cookie / 签名或格式无效 / 已过期 / 用途归属不符 */
  | { status: "missing" }
  /** JWT 本身有效但一次性键已被消费（重放） */
  | { status: "replay" };

/** 校验并一次性消费 challenge；用途/归属不符或过期一律视为无效。 */
export async function readChallenge(
  req: Request,
  purpose: PasskeyChallengePurpose,
  userId: string | null,
): Promise<PasskeyChallengeResult> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${PASSKEY_CHALLENGE_COOKIE}=`))
    ?.slice(PASSKEY_CHALLENGE_COOKIE.length + 1);
  if (!raw) return { status: "missing" };
  let challenge: unknown;
  let jti: unknown;
  let payloadPurpose: unknown;
  let payloadUid: unknown;
  try {
    const { payload } = await jwtVerify(raw.replace(/"/g, ""), challengeSecret());
    challenge = payload.chal;
    jti = payload.jti;
    payloadPurpose = payload.p;
    payloadUid = payload.uid;
  } catch {
    return { status: "missing" };
  }
  if (payloadPurpose !== purpose || payloadUid !== userId) return { status: "missing" };
  if (typeof challenge !== "string" || typeof jti !== "string") return { status: "missing" };
  // 原子消费（Redis GETDEL / PG DELETE RETURNING / 内存）：消费失败 ⇒ 重放
  const consumed = await consumeOneTimeKey(`${ONE_TIME_PREFIX}${jti}`);
  if (!consumed) return { status: "replay" };
  return { status: "ok", challenge };
}
