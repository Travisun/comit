import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccounts, users, type User } from "@/db/schema";
import { AppError, conflict } from "@/core/errors";
import { emit } from "@/core/events";
import { assertUsernameAvailable } from "@/lib/users";
import { randomSuffix } from "@/lib/utils";
import type { FederatedProfile } from "@/lib/auth/oauth";

/**
 * Shared "find or create" logic for every federated login (OAuth, Discourse
 * SSO, Cloudflare Access):
 *   1. (provider, providerAccountId) already linked → that user
 *   2. email matches an existing account → link + that user
 *      （仅当 provider 侧邮箱已验证才允许自动绑定；X 的合成/未验证邮箱一律不绑）
 *   3. otherwise auto-register (emailVerifiedAt mirrors the provider's claim)
 */

export interface FederatedIdentity {
  user: User;
  created: boolean;
}

export async function findOrCreateFederatedUser(
  profile: FederatedProfile,
): Promise<FederatedIdentity> {
  const email = profile.email.trim().toLowerCase();
  if (!email) throw new AppError("该账号未提供邮箱 / Provider did not return an email", 400, "oauth_no_email");

  // 1. existing link
  const [link] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, profile.provider),
        eq(oauthAccounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1);
  if (link) {
    const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    if (user && user.status !== "deleted") return { user, created: false };
  }

  // 2. existing account with the same email → bind（仅限 provider 已验证邮箱：
  //    凭未验证邮箱（如 X 的合成 noreply 地址）自动接管现有账户＝账户接管）
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (profile.emailVerified !== true) {
      throw new AppError(
        "该邮箱已注册，但第三方账号的邮箱未经验证，无法自动绑定 / Email already registered and the provider did not verify it — cannot auto-link",
        409,
        "oauth_email_conflict",
      );
    }
    if (existing.status === "deleted") {
      throw new AppError("该邮箱账户已注销 / This email account was deleted", 400, "oauth_deleted");
    }
    await db
      .insert(oauthAccounts)
      .values({
        userId: existing.id,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      })
      .onConflictDoNothing();
    return { user: existing, created: false };
  }

  // 3. auto-register — 只有 provider 明确验证过邮箱才写 emailVerifiedAt，
  //    否则留 null（后续走常规邮箱验证流程）
  const username = await pickAvailableUsername(profile.username || email.split("@")[0] || "user");
  const [user] = await db
    .insert(users)
    .values({
      email,
      username,
      displayName: (profile.displayName || username).slice(0, 80),
      emailVerifiedAt: profile.emailVerified === true ? new Date() : null,
      locale: "zh",
    })
    .returning();
  await db
    .insert(oauthAccounts)
    .values({
      userId: user.id,
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
    })
    .onConflictDoNothing();
  await emit("user:registered", {
    userId: user.id,
    email: user.email,
    username: user.username,
    invitedByUserId: null,
  });
  return { user, created: true };
}

/** Normalize an arbitrary provider handle into a legal username. */
function normalizeUsernameCandidate(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length >= 2 ? s : "user";
}

async function pickAvailableUsername(raw: string): Promise<string> {
  const base = normalizeUsernameCandidate(raw);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${randomSuffix(4)}`;
    try {
      await assertUsernameAvailable(candidate);
      return candidate;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      // taken or invalid — try a suffixed variant
    }
  }
  // last resort: timestamp suffix virtually never collides
  const fallback = `${base.slice(0, 24)}-${Date.now().toString(36)}`.slice(0, 63);
  try {
    await assertUsernameAvailable(fallback);
    return fallback;
  } catch {
    throw conflict("无法生成可用用户名 / Could not generate an available username");
  }
}
