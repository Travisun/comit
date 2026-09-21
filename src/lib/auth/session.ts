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
 * Cookie 签发寿命 = 会话绝对寿命（config.auth.sessionAbsoluteDays，180 天）。
 * cookie 只是票据载体，真实有效期由 DB sessions.expires_at（滑动上限 30 天）
 * 与 absolute_expires_at（绝对寿命）共同管辖：登出/封禁删除会话行后 cookie
 * 即成废票。cookie 给到绝对寿命上限即可覆盖任何合法会话 —— 超过
 * absolute_expires_at 的会话在 getAuth 一律判定失效（强制重登）。
 */

/**
 * 滑动续期阈值：会话剩余寿命不足 1 天（即已消耗 >1 天）时顺延至完整
 * sessionDays（但绝不越过绝对寿命上限）。写放大控制：每会话至多每天 1 次
 * UPDATE；getAuth 有 React cache 每请求去重，同请求多次调用不会重复写。
 */
const SESSION_SLIDE_THRESHOLD_DAYS = 1;

const DAY_MS = 86400_000;

/** 半认证（pending2fa）会话的 DB 寿命封顶：15 分钟。 */
const PENDING_2FA_TTL_MS = 15 * 60_000;

/**
 * 会话在 DB 侧的两条寿命线（纯函数，便于单测）：
 *  - sliding：expires_at，可被滑动续期（完整会话）；
 *  - absolute：absolute_expires_at，任何续期都不能越过。
 *
 * WHY pending2fa 单独收紧到 15 分钟：登录第一因子（密码 / OAuth 授权码 /
 * passkey）通过后建立的会话是「待补第二因子」的半认证票据，但它原本与完整
 * 会话同样领 30 天滑动 + 180 天绝对寿命 —— 在共享设备上中断流程、或票据经
 * 日志/备份侧信道留存，都会留下一个「只要再命中一次 TOTP/恢复码就升格」的
 * 长期入口。第二因子通过点（setSessionPending2fa(false)）再换发正常寿命。
 */
export function sessionLifetimeMs(pending2fa: boolean): { slidingMs: number; absoluteMs: number } {
  if (pending2fa) return { slidingMs: PENDING_2FA_TTL_MS, absoluteMs: PENDING_2FA_TTL_MS };
  return {
    slidingMs: config.auth.sessionDays * DAY_MS,
    absoluteMs: config.auth.sessionAbsoluteDays * DAY_MS,
  };
}

/**
 * 会话绝对到期时刻（epoch ms）：absolute_expires_at 优先；历史行（列未回填
 * 时为 null）回落到 created_at + sessionAbsoluteDays，保证收紧策略对存量
 * 会话同样生效（最迟签发后 180 天失效）。
 */
export function sessionAbsoluteDeadlineMs(
  session: { absoluteExpiresAt: Date | null; createdAt: Date },
): number {
  if (session.absoluteExpiresAt) return session.absoluteExpiresAt.getTime();
  return session.createdAt.getTime() + config.auth.sessionAbsoluteDays * DAY_MS;
}

/**
 * 滑动续期目标（纯函数，便于测试）：
 *  - 剩余寿命 ≥ 阈值 ⇒ null（不续，控制写放大）；
 *  - 需要续 ⇒ newExpiresAt = min(now + sessionDays, absoluteDeadline)，
 *    但若不晚于当前 expiresAt（已贴着绝对上限）同样返回 null（不写库）。
 */
export function computeSessionSlideTarget(opts: {
  nowMs: number;
  expiresAtMs: number;
  absoluteDeadlineMs: number;
  sessionDays: number;
  thresholdDays: number;
}): number | null {
  const { nowMs, expiresAtMs, absoluteDeadlineMs, sessionDays, thresholdDays } = opts;
  if (expiresAtMs - nowMs >= thresholdDays * DAY_MS) return null;
  const target = Math.min(nowMs + sessionDays * DAY_MS, absoluteDeadlineMs);
  return target > expiresAtMs ? target : null;
}

export async function createSession(
  userId: string,
  opts: { pending2fa?: boolean; ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  const pending = opts.pending2fa ?? false;
  const { slidingMs, absoluteMs } = sessionLifetimeMs(pending);
  const expiresAt = new Date(now + slidingMs);
  const absoluteExpiresAt = new Date(now + absoluteMs);
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      pending2fa: pending,
      ip: opts.ip,
      userAgent: opts.userAgent,
      expiresAt,
      absoluteExpiresAt,
    })
    .returning({ id: sessions.id });
  const store = await cookies();
  // cookie 寿命恒等于完整会话绝对寿命上限（见文件顶部注释），**不随 pending2fa
  // 收紧**：cookie 只是票据载体，短命判定全在 DB；若按 15 分钟设 cookie，用户
  // 完成 2FA 升格会话后浏览器仍会在 15 分钟时丢掉这张已升格的票据。
  store.set(config.auth.sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.app.isProd,
    path: "/",
    expires: new Date(now + config.auth.sessionAbsoluteDays * DAY_MS),
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return row.id;
}

export async function setSessionPending2fa(sessionId: string, pending: boolean) {
  const now = Date.now();
  const { slidingMs, absoluteMs } = sessionLifetimeMs(pending);
  // 通过第二因子 = 半认证票据升格为完整会话：同时换发正常滑动/绝对寿命；
  // 反向置回 pending 时只改标记，不延长寿命（收紧永远合法、放宽必须有凭据）。
  await db
    .update(sessions)
    .set({ pending2fa: pending, expiresAt: new Date(now + slidingMs), absoluteExpiresAt: new Date(now + absoluteMs) })
    .where(eq(sessions.id, sessionId));
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
  // 绝对寿命门槛（absolute lifetime）：签发后无论活跃度如何，超过
  // sessionAbsoluteDays 一律失效（返回 null ⇒ 视为未登录，前端跳登录页）。
  // 不在此处删行——retention cron 按 expires_at 统一清理；cookie 残留票据
  // 因 DB 判定失败即成废票。
  const now = Date.now();
  if (sessionAbsoluteDeadlineMs(row.session) <= now) return null;
  // 滑动续期（sliding renewal）：会话有效但剩余寿命 < sessionDays-1 天 ⇒ 顺延
  // 至完整 sessionDays，但绝不越过绝对寿命上限（min 收敛在
  // computeSessionSlideTarget 内完成）。DB 内仍带 expiresAt > now() 守卫
  // （select 与 update 之间会话不过期）。只续 DB 不续 cookie —— RSC 不能
  // Set-Cookie，cookie 在签发点已给到绝对寿命上限（见文件顶部注释）。
  const slideTargetMs = computeSessionSlideTarget({
    nowMs: now,
    expiresAtMs: row.session.expiresAt.getTime(),
    absoluteDeadlineMs: sessionAbsoluteDeadlineMs(row.session),
    sessionDays: config.auth.sessionDays,
    thresholdDays: SESSION_SLIDE_THRESHOLD_DAYS,
  });
  if (slideTargetMs !== null) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(slideTargetMs) })
      .where(and(eq(sessions.id, row.session.id), gt(sessions.expiresAt, new Date())));
  }
  return { user: row.user, sessionId: row.session.id, pending2fa: row.session.pending2fa };
});

export async function getCurrentUser(): Promise<User | null> {
  const auth = await getAuth();
  if (!auth || auth.pending2fa) return null;
  return auth.user;
}
