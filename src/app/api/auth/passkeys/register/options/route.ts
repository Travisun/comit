import { generateRegistrationOptions } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/core/config";
import { db } from "@/db";
import { passkeyCredentials } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { withUser } from "@/lib/http";
import { getSetting } from "@/lib/settings";
import { challengeCookie, rpFromRequest } from "@/lib/auth/passkey";

export const runtime = "nodejs";

/**
 * GET /api/auth/passkeys/register/options — 为当前登录用户生成 WebAuthn 注册
 * 参数（排除已注册凭据），challenge 存 HttpOnly 短时 cookie 供 verify 校验。
 */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    if (!(await getSetting("auth.passkeys"))) {
      throw forbidden("站点未开启通行密钥登录 / Passkey sign-in is not enabled");
    }
    const { rpID, rpName } = await rpFromRequest(req);
    const existing = await db
      .select({ id: passkeyCredentials.credentialId, transports: passkeyCredentials.transports })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, auth.user.id));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: auth.user.username,
      userDisplayName: auth.user.displayName || auth.user.username,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.id,
        transports: c.transports as never,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    const cookie = await challengeCookie("pk_register", options.challenge, auth.user.id);
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
