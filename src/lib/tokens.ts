import { apiTokens } from "@/db/schema";
import { db } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
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
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return { userId: row.userId, scopes: row.scopes, tokenId: row.id };
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
