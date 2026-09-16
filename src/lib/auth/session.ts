import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, ne, or, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { config } from "@/core/config";
import { randomToken, sha256 } from "./password";

/**
 * DB-backed session auth. Cookies are httpOnly + SameSite=Lax; CSRF for
 * mutations is handled by same-site cookies + an origin check helper in
 * src/lib/http.ts.
 */

export interface AuthContext {
  user: User;
  sessionId: string;
  pending2fa: boolean;
}

export async function createSession(
  userId: string,
  opts: { pending2fa?: boolean; ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.auth.sessionDays * 86400_000);
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      pending2fa: opts.pending2fa ?? false,
      ip: opts.ip,
      userAgent: opts.userAgent,
      expiresAt,
    })
    .returning({ id: sessions.id });
  const store = await cookies();
  store.set(config.auth.sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.app.isProd,
    path: "/",
    expires: expiresAt,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return row.id;
}

export async function setSessionPending2fa(sessionId: string, pending: boolean) {
  await db.update(sessions).set({ pending2fa: pending }).where(eq(sessions.id, sessionId));
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(config.auth.sessionCookie)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  store.delete(config.auth.sessionCookie);
}

export async function destroyUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  // 单条 DELETE（原来先 SELECT 再逐行删除，N+1）
  await db.delete(sessions).where(
    exceptSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
      : eq(sessions.userId, userId),
  );
}

/** Get the current auth context (memoized per request). Timed bans gate here. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  const token = store.get(config.auth.sessionCookie)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
        // timed ban: banned_until set and in the future ⇒ not signed in
        or(isNull(users.bannedUntil), lt(users.bannedUntil, sql`now()`)),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { user: row.user, sessionId: row.session.id, pending2fa: row.session.pending2fa };
});

export async function getCurrentUser(): Promise<User | null> {
  const auth = await getAuth();
  if (!auth || auth.pending2fa) return null;
  return auth.user;
}
