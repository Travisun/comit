import { apiTokens, users } from "@/db/schema";
import { db } from "@/db";
import { and, count, eq, isNull, lt, or, sql } from "drizzle-orm";
import { randomToken, sha256 } from "@/lib/auth/password";
import { AppError } from "@/core/errors";

/**
 * API tokens for MCP / REST access. Format: mbt_<prefix>_<secret>
 * Only sha256(secret) is stored; prefix is displayed for identification.
 */
export const TOKEN_SCOPES = [
  "posts:read",
  "posts:write",
  "media:read",
  "media:write",
  "comments:read",
  "feed:read",
  "profile:read",
] as const;

/** 每用户未撤销 token 上限：无上限时批量签发可无限膨胀按 token 的限流键与
 * resolveApiToken 的候选行；20 个对个人 agent 场景足够宽裕。 */
const MAX_ACTIVE_TOKENS_PER_USER = 20;

export async function createApiToken(userId: string, name: string, scopes: string[]) {
  const [existing] = await db
    .select({ n: count() })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if ((existing?.n ?? 0) >= MAX_ACTIVE_TOKENS_PER_USER) {
    throw new AppError(
      `活跃 API 令牌已达上限（${MAX_ACTIVE_TOKENS_PER_USER}），请先撤销不再使用的令牌 / Active token limit reached`,
      409,
      "token_limit",
    );
  }
  const secret = randomToken(24);
  const prefix = randomToken(6).slice(0, 6);
  const token = `mbt_${prefix}_${secret}`;
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: name || "unnamed",
      prefix,
      tokenHash: sha256(token),
      scopes,
    })
    .returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function resolveApiToken(token: string): Promise<{ userId: string; scopes: string[]; tokenId: string } | null> {
  if (!token.startsWith("mbt_")) return null;
  const [row] = await db
    .select({ token: apiTokens })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, sha256(token)),
        isNull(apiTokens.revokedAt),
        // 与 web 会话门控（getAuth）同口径：封禁/注销用户或临时封禁未到期的
        // token 一律拒绝；解封后自动恢复，无需重新签发。
        eq(users.status, "active"),
        or(isNull(users.bannedUntil), lt(users.bannedUntil, sql`now()`)),
      ),
    )
    .limit(1);
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.token.id));
  return { userId: row.token.userId, scopes: row.token.scopes, tokenId: row.token.id };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(apiTokens.createdAt);
}

/**
 * 撤销某用户全部活跃 API 令牌（幂等：只动 revoked_at IS NULL 的行）。
 *
 * WHY：API 令牌是**不经会话体系**的长期 bearer 凭证 —— 找回密码只靠邮件链接
 * （仅证明邮箱控制权，不证明设备/会话合法性），若重置后旧令牌继续可用，
 * 攻击者在得手邮箱前偷到的 MCP/REST 令牌可在用户「改密 + 吊销全部会话」之后
 * 原样维持访问，等于留了一条不被吊销的持久后门。故仅找回密码路径全量撤销；
 * 主动改密（/api/me/password，必须出示当前密码）不动自动化令牌，避免把用户
 * 的 agent/CI 凭证连带打断。
 */
export async function revokeAllApiTokens(userId: string): Promise<number> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length;
}
