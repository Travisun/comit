import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { clientIp } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { exchangeOAuthCode, oauthEnabled } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "../../../_lib/federated";

export const runtime = "nodejs";

const PROVIDERS = new Set(["github", "google", "x"]);
const STATE_COOKIE = "mb_oauth_state";
const VERIFIER_COOKIE = "mb_oauth_verifier";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    const { provider } = await ctx.params;
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.cookies.get(STATE_COOKIE)?.value;
    const verifier = req.cookies.get(VERIFIER_COOKIE)?.value;

    if (
      url.searchParams.get("error") ||
      !code ||
      !state ||
      !cookieState ||
      state !== cookieState ||
      !PROVIDERS.has(provider) ||
      !oauthEnabled(provider)
    ) {
      return NextResponse.redirect(loginError);
    }

    const profile = await exchangeOAuthCode(provider, code, verifier);
    const { user } = await findOrCreateFederatedUser(profile);
    await createSession(user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const target = (await hasConfirmedTotp(user.id)) ? routes.twofaChallenge : routes.twofaSetup;
    const res = NextResponse.redirect(absolute(target));
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(VERIFIER_COOKIE);
    return res;
  } catch (err) {
    console.error("[auth/oauth] callback failed:", err);
    return NextResponse.redirect(loginError);
  }
}
