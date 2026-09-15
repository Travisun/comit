import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config } from "@/core/config";
import { routes, absolute } from "@/core/routes";
import { getSetting, type SettingsKey } from "@/lib/settings";
import { randomToken } from "@/lib/auth/password";
import { createOAuthUrl, oauthEnabled } from "@/lib/auth/oauth";

export const runtime = "nodejs";

/** Only pure OAuth2 providers use this start route. */
const PROVIDERS = ["github", "google", "x"] as const;
type Provider = (typeof PROVIDERS)[number];

const SSO_KEY: Record<Provider, SettingsKey> = {
  github: "sso.github",
  google: "sso.google",
  x: "sso.x",
};

const STATE_COOKIE = "mb_oauth_state";
const VERIFIER_COOKIE = "mb_oauth_verifier";
const LINK_COOKIE = "mb_oauth_link";
const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.app.isProd,
  path: "/",
  maxAge: 600,
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    const { provider } = await ctx.params;
    if (!PROVIDERS.includes(provider as Provider)) {
      return NextResponse.redirect(loginError);
    }
    const p = provider as Provider;
    if (!oauthEnabled(p) || !(await getSetting(SSO_KEY[p]))) {
      return NextResponse.redirect(loginError);
    }

    // 设置页「账号绑定」发起：link=1 且已登录 → 回调时绑定到当前账户
    let linkUserId: string | null = null;
    if (_req.nextUrl.searchParams.get("link") === "1") {
      const { getCurrentUser } = await import("@/lib/auth/session");
      const user = await getCurrentUser();
      if (user) linkUserId = user.id;
    }

    const state = randomToken(16);
    const { url: oauthUrl, codeVerifier } = await createOAuthUrl(p, state);
    const url = oauthUrl;
    const res = NextResponse.redirect(url.toString());
    res.cookies.set(STATE_COOKIE, state, COOKIE_BASE);
    if (codeVerifier) res.cookies.set(VERIFIER_COOKIE, codeVerifier, COOKIE_BASE);
    if (linkUserId) {
      res.cookies.set(LINK_COOKIE, linkUserId, { ...COOKIE_BASE, maxAge: 600 });
    }
    return res;
  } catch (err) {
    console.error("[auth/oauth] start failed:", err);
    return NextResponse.redirect(loginError);
  }
}
