import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { AppError } from "@/core/errors";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { safeCompare } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { verifyDiscourseCallback } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "../../../_lib/federated";
import { consumeFlowParam } from "../../../_lib/flow-nonce";

export const runtime = "nodejs";

function decodePayloadNonce(sso: string): string | null {
  try {
    return new URLSearchParams(Buffer.from(sso, "base64").toString("utf8")).get("nonce");
  } catch {
    return null;
  }
}

/** 登录失败跳转：一并清掉 mb_sso_nonce cookie，不把一次性 nonce 留在浏览器。 */
function loginErrorRedirect(error = "oauth") {
  const res = NextResponse.redirect(absolute(`${routes.login}?error=${error}`));
  res.cookies.delete("mb_sso_nonce");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    // 与 OAuth/CF 回调同口径的 IP 桶：该端点会建会话且原先完全无限流
    await rateLimitBucket("auth.federated.callback", clientIp(req));
    const url = new URL(req.url);
    const sso = url.searchParams.get("sso") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const cookieNonce = req.cookies.get("mb_sso_nonce")?.value ?? "";

    if (!sso || !sig || !cookieNonce) return loginErrorRedirect();

    // 先验 HMAC 再碰 nonce：未验签 payload 里的 nonce 由请求方任意构造，
    // 拿它去消费会把用户正在进行的流程误烧掉。
    const profile = await verifyDiscourseCallback(sso, sig);
    if (!profile) return loginErrorRedirect();

    // nonce 是 CSRF 绑定（必须等于本站为该浏览器签发的那枚），同时单次消费：
    // Discourse 回包的签名 payload 永不过期（协议无时间戳），没有消费登记的话
    // 一条泄露出去的回调 URL 可被反复用于建会话。
    const payloadNonce = decodePayloadNonce(sso) ?? "";
    if (
      !safeCompare(payloadNonce, cookieNonce) ||
      !(await consumeFlowParam("sso_nonce", payloadNonce))
    ) {
      return loginErrorRedirect();
    }

    const { user } = await findOrCreateFederatedUser(profile);
    await createSession(user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const target = (await hasConfirmedTotp(user.id)) ? routes.twofaChallenge : routes.twofaSetup;
    const res = NextResponse.redirect(absolute(target));
    res.cookies.delete("mb_sso_nonce");
    return res;
  } catch (err) {
    console.error("[auth/sso/discourse] callback failed:", err);
    // 邮箱命中既有账户但 discourse 从未绑定 → 引导登录后到设置页主动绑定
    if (err instanceof AppError && err.code === "oauth_email_registered") {
      return loginErrorRedirect("oauth_email_registered");
    }
    return loginErrorRedirect();
  }
}
