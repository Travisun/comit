import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { clientIp } from "@/lib/rate-limit";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { exchangeOAuthCode, oauthEnabled } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "../../../_lib/federated";

export const runtime = "nodejs";

const PROVIDERS = new Set(["github", "google", "x"]);
const STATE_COOKIE = "mb_oauth_state";
const LINK_COOKIE = "mb_oauth_link";
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

    // 绑定模式：来自设置页「账号绑定」，把第三方账户挂到当前登录用户
    const linkUserId = req.cookies.get("mb_oauth_link")?.value;
    if (linkUserId) {
      const [linkUser] = await db.select().from(users).where(eq(users.id, linkUserId)).limit(1);
      if (!linkUser || linkUser.status !== "active") {
        return NextResponse.redirect(absolute("/settings/connections?error=session"));
      }
      const [clash] = await db
        .select({ userId: oauthAccounts.userId })
        .from(oauthAccounts)
        .where(
          and(
            eq(oauthAccounts.provider, provider),
            eq(oauthAccounts.providerAccountId, profile.providerAccountId),
          ),
        )
        .limit(1);
      if (clash && clash.userId !== linkUserId) {
        return NextResponse.redirect(absolute("/settings/connections?error=taken"));
      }
      await db
        .insert(oauthAccounts)
        .values({
          userId: linkUserId,
          provider,
          providerAccountId: profile.providerAccountId,
        })
        .onConflictDoNothing();
      const res = NextResponse.redirect(absolute(`/settings/connections?linked=${provider}`));
      res.cookies.delete(LINK_COOKIE);
      res.cookies.delete(STATE_COOKIE);
      res.cookies.delete(VERIFIER_COOKIE);
      return res;
    }

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
