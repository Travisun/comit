import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authTokens } from "@/db/schema";
import { getAuth, type AuthContext } from "./session";
import { randomToken, sha256 } from "./password";
import { routes } from "@/core/routes";

/** Page guard: fully signed-in user (2FA passed), else redirect to login. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect(routes.login);
  if (auth.pending2fa) redirect(routes.twofaChallenge);
  if (!auth.user.emailVerifiedAt) redirect(routes.verifyEmail);
  return auth;
}

export async function requireAdmin(): Promise<AuthContext> {
  const auth = await requireUser();
  if (auth.user.role !== "admin") redirect("/");
  return auth;
}

/** API guard variant: returns null instead of redirecting. */
export async function apiUser(): Promise<AuthContext | null> {
  const auth = await getAuth();
  if (!auth || auth.pending2fa || !auth.user.emailVerifiedAt) return null;
  return auth;
}

/* --------------------------- email / reset tokens ----------------------- */

/**
 * 一次性令牌用途（与 schema 的 token_type 枚举同集合）。
 * 签发与消费都必须显式带 type ⇒ 邮件验证令牌永远不能被当作找回密码令牌使用
 * （跨用途重放在 SQL 条件层就被挡掉，见 consumeAuthToken）。
 */
export type AuthTokenType = "email_verify" | "password_reset";

export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMinutes = 60 * 24,
): Promise<string> {
  const token = randomToken(32);
  // 作废旧 token：重发验证/找回邮件不得让历史 token 并行有效（泄露面累积）
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
      ),
    );
  await db.insert(authTokens).values({
    userId,
    type,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });
  return token;
}

/**
 * 原子消费一次性令牌：UPDATE … WHERE used_at IS NULL RETURNING 单语句完成
 * 「认领」，并发双花时后到者命中 0 行 ⇒ 返回 null（行锁串行化，不存在
 * check-then-set 竞态）。令牌以 sha256 落库、按哈希等值查库比对，256 位随机
 * 原文不可猜 ⇒ 无需对原文做常数时间比较（DB 侧只泄露哈希前缀匹配时序，
 * 对高熵随机值无意义）。过期判定放在认领之后：过期令牌同样被置为已用，
 * 不给重复提交留任何状态。
 */
export async function consumeAuthToken(
  token: string,
  type: AuthTokenType,
): Promise<string | null> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
      ),
    )
    .returning({ userId: authTokens.userId, expiresAt: authTokens.expiresAt });
  if (!row || row.expiresAt < new Date()) return null;
  return row.userId;
}

/**
 * 吊销该用户全部（或指定用途）未消费的待决令牌，返回吊销条数。
 *
 * WHY：凭据/邮箱变更是「账户控制权可能已易主」的确定信号，变更成功后残留的
 * 一次性令牌必须一并作废，否则出现两条真实接管路径：
 *  - 换绑邮箱后，此前发到**旧邮箱**的 password_reset 链接（30 分钟窗口）仍可
 *    重置已属于新邮箱的账户；
 *  - 改密/重置后，仍有效的 email_verify 链接（24 小时窗口）可把邮箱改回攻击者
 *    地址 —— 会话虽被吊销，攻击者凭邮箱仍能自助接管。
 * 消费型吊销（issueAuthToken 只清同类型）不覆盖跨类型残留，故独立提供。
 */
export async function revokeAuthTokens(userId: string, types?: AuthTokenType[]): Promise<number> {
  const rows = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        ...(types?.length ? [inArray(authTokens.type, types)] : []),
        isNull(authTokens.usedAt),
      ),
    )
    .returning({ id: authTokens.id });
  return rows.length;
}
