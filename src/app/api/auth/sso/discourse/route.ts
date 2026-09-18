import { NextResponse } from "next/server";

import { config } from "@/core/config";
import { routes, absolute } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { randomToken } from "@/lib/auth/password";
import { discourseSsoStartUrl, oauthEnabled } from "@/lib/auth/oauth";

export const runtime = "nodejs";

export async function GET() {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    if (!(await oauthEnabled("discourse")) || !(await getSetting("sso.discourse"))) {
      return NextResponse.redirect(loginError);
    }
    const nonce = randomToken(16);
    const res = NextResponse.redirect(await discourseSsoStartUrl(nonce, "/api/auth/sso/discourse/callback"));
    res.cookies.set("mb_sso_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.app.isProd,
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    console.error("[auth/sso/discourse] start failed:", err);
    return NextResponse.redirect(loginError);
  }
}
