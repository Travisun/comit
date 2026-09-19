import { SignJWT, jwtVerify } from "jose";
import { config } from "@/core/config";
import { getSetting } from "@/lib/settings";

/**
 * WebAuthn 通行密钥（Passkey）服务端助手：
 *  - RP（Relying Party）参数从请求头推导 —— 反代（宝塔 nginx + Cloudflare）后
 *    以 x-forwarded-host / x-forwarded-proto 为准，浏览器侧 origin 与之一致；
 *  - challenge 状态存于 HttpOnly 短时 JWT cookie（5 分钟），API 保持无状态，
 *    不引入服务端会话存储。
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

/** 签发 challenge cookie（JWT 载荷携带 challenge + 用途 + 归属用户）。 */
export async function challengeCookie(
  purpose: PasskeyChallengePurpose,
  challenge: string,
  userId: string | null,
): Promise<{ name: string; value: string; maxAge: number }> {
  const value = await new SignJWT({ p: purpose, uid: userId, chal: challenge })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SEC}s`)
    .sign(challengeSecret());
  return { name: PASSKEY_CHALLENGE_COOKIE, value, maxAge: CHALLENGE_TTL_SEC };
}

/** 校验并取出 challenge；用途/归属不符或过期一律返回 null。 */
export async function readChallenge(
  req: Request,
  purpose: PasskeyChallengePurpose,
  userId: string | null,
): Promise<string | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${PASSKEY_CHALLENGE_COOKIE}=`))
    ?.slice(PASSKEY_CHALLENGE_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw.replace(/"/g, ""), challengeSecret());
    if (payload.p !== purpose || payload.uid !== userId) return null;
    return typeof payload.chal === "string" ? payload.chal : null;
  } catch {
    return null;
  }
}
