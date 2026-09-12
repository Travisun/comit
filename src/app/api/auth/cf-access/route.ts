import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { clientIp } from "@/lib/rate-limit";
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
    if (!oauthEnabled("cfaccess") || !(await getSetting("sso.cfaccess"))) {
      return NextResponse.redirect(loginError);
    }
    const jwt =
      req.headers.get("Cf-Access-Jwt-Assertion") ??
      req.cookies.get("CF_Authorization")?.value ??
      "";
    if (!jwt) return NextResponse.redirect(loginError);

    const profile = await verifyCfAccessJwt(jwt);
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
    return NextResponse.redirect(loginError);
  }
}
