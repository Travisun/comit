import { apiTokens, users } from "@/db/schema";
import { db } from "@/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { randomToken, sha256 } from "@/lib/auth/password";

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

export async function createApiToken(userId: string, name: string, scopes: string[]) {
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
