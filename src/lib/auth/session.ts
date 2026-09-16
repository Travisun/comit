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

/**
 * Cookie 签发寿命（365 天）。cookie 只是票据载体，真实有效期由 DB
 * sessions.expires_at 管辖：登出/封禁删除会话行后 cookie 即成废票，安全性不降。
 * 给足寿命是因为 getAuth 的滑动续期只能延长 DB（RSC 中不能 Set-Cookie，无法
 * 每请求续签 cookie），固定 30d cookie 会先于滑动后的 DB 过期把用户登出。
 * 旧 30d cookie 自然过渡：仍可用，下次登录时换发 365d cookie，不破坏现有会话。
 */
const SESSION_COOKIE_MAX_DAYS = 365;

/**
 * 滑动续期阈值：会话剩余寿命不足 1 天（即已消耗 >1 天）时顺延至完整
 * sessionDays。写放大控制：每会话至多每天 1 次 UPDATE；getAuth 有 React
 * cache 每请求去重，同请求多次调用不会重复写。
 */
const SESSION_SLIDE_THRESHOLD_DAYS = 1;

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
  // cookie 有效期给足 365 天（见 SESSION_COOKIE_MAX_DAYS 注释）；DB 仍按 sessionDays 记账
  store.set(config.auth.sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.app.isProd,
    path: "/",
    expires: new Date(Date.now() + SESSION_COOKIE_MAX_DAYS * 86400_000),
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
  // 滑动续期（sliding renewal）：会话有效但剩余寿命 < sessionDays-1 天 ⇒ 顺延
  // 至完整 sessionDays，长活跃用户不再被 30 天硬过期随机登出。DB 内仍带
  // expiresAt > now() 守卫（select 与 update 之间会话不过期）。只续 DB 不续
  // cookie —— RSC 不能 Set-Cookie，cookie 在签发点已给足寿命（见文件顶部常量）。
  if (row.session.expiresAt.getTime() - Date.now() < SESSION_SLIDE_THRESHOLD_DAYS * 86400_000) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + config.auth.sessionDays * 86400_000) })
      .where(and(eq(sessions.id, row.session.id), gt(sessions.expiresAt, new Date())));
  }
  return { user: row.user, sessionId: row.session.id, pending2fa: row.session.pending2fa };
});

export async function getCurrentUser(): Promise<User | null> {
  const auth = await getAuth();
  if (!auth || auth.pending2fa) return null;
  return auth.user;
}
