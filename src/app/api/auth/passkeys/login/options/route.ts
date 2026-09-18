import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config } from "@/core/config";
import { forbidden } from "@/core/errors";
import { withApi } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getSetting } from "@/lib/settings";
import { challengeCookie, rpFromRequest } from "@/lib/auth/passkey";

export const runtime = "nodejs";

/**
 * GET /api/auth/passkeys/login/options — 无标识符的可发现凭据登录（resident
 * key）：不传 allowCredentials，浏览器弹出本机为本 RP 保存的全部通行密钥。
 * challenge 存 HttpOnly 短时 cookie。
 */
export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.passkey", clientIp(req));
    if (!(await getSetting("auth.passkeys"))) {
      throw forbidden("站点未开启通行密钥登录 / Passkey sign-in is not enabled");
    }
    const { rpID } = await rpFromRequest(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
    });

    const cookie = await challengeCookie("pk_login", options.challenge, null);
    const res = NextResponse.json(options);
    res.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.app.isProd,
      path: "/",
      maxAge: cookie.maxAge,
    });
    return res;
  });
}
