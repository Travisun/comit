import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { clientIp } from "@/lib/rate-limit";
import { createSession, getAuth } from "@/lib/auth/session";
import { db } from "@/db";
import { oauthAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { exchangeOAuthCode, oauthEnabled } from "@/lib/auth/oauth";
import { AppError } from "@/core/errors";
import { findOrCreateFederatedUser } from "../../../_lib/federated";

export const runtime = "nodejs";

const PROVIDERS = new Set(["github", "google", "x", "linuxdo"]);
const STATE_COOKIE = "mb_oauth_state";
const LINK_COOKIE = "mb_oauth_link";
const VERIFIER_COOKIE = "mb_oauth_verifier";

/**
 * 统一出口：离开回调前清掉三个流程 cookie。bind 模式成败与所有错误出口共用 ——
 * 残留的 mb_oauth_link（600s maxAge）会把下一次非 bind 登录误判成 bind 尝试；
 * state/verifier 残留同理可能被复用。login 模式的正常成功出口单独保留
 * （只清 STATE/VERIFIER，语义不变，见 GET 内成功分支）。
 */
function flowExit(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.delete(LINK_COOKIE);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}

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
      !(await oauthEnabled(provider))
    ) {
      return flowExit(loginError);
    }

    const profile = await exchangeOAuthCode(provider, code, verifier);

    // 绑定模式：来自设置页「账号绑定」，把第三方账户挂到当前登录用户。
    // 安全：link cookie 可被伪造，绝不能直接信任——必须与当前会话用户一致
    // （且会话已完整通过 2FA）才允许绑定。
    const linkUserId = req.cookies.get(LINK_COOKIE)?.value;
    if (linkUserId) {
      const auth = await getAuth();
      if (!auth || auth.pending2fa || auth.user.id !== linkUserId) {
        return flowExit(absolute(`${routes.login}?error=session`));
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
        return flowExit(absolute("/settings/connections?error=taken"));
      }
      await db
        .insert(oauthAccounts)
        .values({
          userId: linkUserId,
          provider,
          providerAccountId: profile.providerAccountId,
        })
        .onConflictDoNothing();
      return flowExit(absolute(`/settings/connections?linked=${provider}`));
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
    // provider 邮箱未验证却撞上现有账户 → 用独立错误码，区别于笼统 oauth
    if (err instanceof AppError && err.code === "oauth_email_conflict") {
      return flowExit(absolute(`${routes.login}?error=oauth_email`));
    }
    return flowExit(loginError);
  }
}
