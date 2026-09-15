import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccounts, users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { oauthEnabled } from "@/lib/auth/oauth";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["github", "google"] as const;

function ssoKey(provider: string): "sso.github" | "sso.google" {
  return provider === "google" ? "sso.google" : "sso.github";
}

/** GET /api/me/connections — 各 OAuth 登录方式的启用与绑定状态。 */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const links = await db
      .select({ provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, auth.user.id));
    const linked = new Set(links.map((l) => l.provider));

    const connections = await Promise.all(
      PROVIDERS.map(async (provider) => ({
        provider,
        enabled:
          oauthEnabled(provider) &&
          Boolean(await getSetting(ssoKey(provider) as "sso.github")),
        linked: linked.has(provider),
      })),
    );
    return ok({ connections });
  });
}

/** DELETE /api/me/connections?provider= — 解除绑定。
 * 安全约束：账户必须保留密码或至少一个其他已绑定的登录方式。 */
export async function DELETE(req: Request) {
  return withUser(req, async (auth) => {
    const provider = new URL(req.url).searchParams.get("provider") ?? "";
    if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
      throw forbidden("不支持的登录方式 / Unsupported provider");
    }

    const links = await db
      .select({ provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, auth.user.id));
    const remaining = links.filter((l) => l.provider !== provider);

    // 解绑后必须仍有可行登录方式：密码，或其他已绑定方式
    if (!auth.user.passwordHash && remaining.length === 0) {
      throw forbidden(
        "解绑前请先设置密码，或保留至少一个绑定方式 / Set a password or keep another login method first",
      );
    }

    await db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, auth.user.id), eq(oauthAccounts.provider, provider)));
    return ok({ unlinked: provider });
  });
}
