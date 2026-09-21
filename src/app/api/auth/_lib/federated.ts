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
 *   1. (provider, providerAccountId) already linked → that user（唯一自动登入
 *      通道：该账号此前就用同一 provider 登录过）
 *   2. email matches an existing account but this provider was never linked
 *      → 拒绝自动登入（身份提供商仅凭邮箱接管账号是账户接管向量），要求用户
 *      登录后到 设置 → 账号绑定 主动绑定（bind 流程见 oauth callback 的
 *      mb_oauth_link cookie 分支）
 *   3. otherwise auto-register —— 仅限 provider 侧邮箱已验证
 *      （emailVerified === true；合成 noreply 邮箱由 provider 证明身份，视同
 *      已验证，见 FederatedProfile.emailSynthetic 注释）；email_verified
 *      缺失/false 一律拒绝自动注册。
 *
 * 历史风险修复：旧逻辑第 2 步"邮箱命中即自动绑定并登入"，即使 provider
 * 邮箱已验证也放行 —— 任何被用户关联过邮箱的账号都可被对应 IdP 接管。
 * 现收紧为仅 (provider, providerAccountId) 精确匹配才自动关联。
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

  // 1. existing link（唯一自动登入通道）
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

  // 2. email matches an existing account，但该 provider 从未关联过它 →
  //    绝不自动绑定/登入（陌生 provider 凭邮箱登入 = 账户接管向量）。
  //    用户须先在别处登录，再到 设置 → 账号绑定 发起 bind（回调的
  //    mb_oauth_link 分支会校验 link 用户 == 当前会话用户后才落绑定）。
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (existing.status === "deleted") {
      throw new AppError("该邮箱账户已注销 / This email account was deleted", 400, "oauth_deleted");
    }
    throw new AppError(
      "该邮箱已被注册，请先登录后在 设置 → 账号绑定 中绑定此第三方账号 / This email is already registered — sign in first, then link this provider under Settings → Connections",
      409,
      "oauth_email_registered",
    );
  }

  // 3. auto-register —— provider 邮箱未验证（email_verified 缺失/false）一律
  //    拒绝（防用受害者邮箱注册占位账号 + 邮件类身份滥用）。合成 noreply
  //    邮箱（X）例外：邮箱本身不可验证但身份由 provider 用账号句柄证明，
  //    且合成邮箱永远不可能与真实账户的邮箱撞库绑入（第 2 步已封死邮箱
  //    自动绑定）。统一不写 emailVerifiedAt：站内验证关卡照走 /auth/verify。
  if (profile.emailVerified !== true && profile.emailSynthetic !== true) {
    throw new AppError(
      "第三方账号未提供已验证邮箱，无法自动注册 / The provider did not return a verified email, cannot auto-register",
      403,
      "oauth_email_unverified",
    );
  }
  const username = await pickAvailableUsername(profile.username || email.split("@")[0] || "user");
  const [user] = await db
    .insert(users)
    .values({
      email,
      username,
      displayName: (profile.displayName || username).slice(0, 80),
      emailVerifiedAt: null,
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
