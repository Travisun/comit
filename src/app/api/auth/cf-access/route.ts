import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { AppError } from "@/core/errors";
import { getSetting } from "@/lib/settings";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { oauthEnabled, verifyCfAccessJwt } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "../_lib/federated";

export const runtime = "nodejs";

/**
 * Cloudflare Access login: Cloudflare injects a signed JWT that we verify
 * against the team's public keys, then run the usual find-or-create flow.
 */
export async function GET(req: NextRequest) {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    // 建会话端点的 IP 桶（原先完全无限流）；超限走同一条登录失败回落
    await rateLimitBucket("auth.federated.callback", clientIp(req));
    if (!(await oauthEnabled("cfaccess")) || !(await getSetting("sso.cfaccess"))) {
      return NextResponse.redirect(loginError);
    }
    const headerJwt = req.headers.get("Cf-Access-Jwt-Assertion");
    const cookieJwt = req.cookies.get("CF_Authorization")?.value;
    const jwt = headerJwt ?? cookieJwt ?? "";
    if (!jwt) return NextResponse.redirect(loginError);

    // iat 新鲜度窗口按来源区分：
    //  - header 由 CF 边缘**每次请求现签**，正常情况只有秒级年龄 ⇒ 60s 足够，
    //    可挡住被截获的旧断言被长期重放（每次重放都能 mint 新会话）；
    //  - cookie 的寿命即 Access Session Duration（可配到数天），收紧会误伤
    //    合法长会话，其重放窗口由 CF 自己签的 exp 界定。
    const profile = await verifyCfAccessJwt(jwt, headerJwt ? { maxIatAgeSec: 60 } : {});
    if (!profile) return NextResponse.redirect(loginError);

    const { user } = await findOrCreateFederatedUser(profile);
    await createSession(user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const target = (await hasConfirmedTotp(user.id)) ? routes.twofaChallenge : routes.twofaSetup;
    return NextResponse.redirect(absolute(target));
  } catch (err) {
    console.error("[auth/cf-access] failed:", err);
    // 邮箱命中既有账户但 cfaccess 从未绑定 → 引导登录后到设置页主动绑定
    if (err instanceof AppError && err.code === "oauth_email_registered") {
      return NextResponse.redirect(absolute(`${routes.login}?error=oauth_email_registered`));
    }
    return NextResponse.redirect(loginError);
  }
}
