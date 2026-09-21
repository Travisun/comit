/**
 * SSE 长连接的会话有效性复核。
 *
 * 背景：SSE 流在 GET 时校验一次会话后即"冻结"身份 —— 登出/封禁/邮箱验证回
 * 退后，已建立的流仍会无限期推送。这里提供连接建立后每次心跳的复核：
 * 会话行过期（登出会删行）、用户被 ban（status≠active 或 timed ban 生效）、
 * emailVerifiedAt 被清空 → 终止流。
 *
 * 判定核心 {@link sessionStillValid} 为纯函数，可单测；DB 读取独立成
 * loadSseSessionState（懒 import @/db，保持本模块测试零连接副作用），路由
 * 侧把两者串起来。
 *
 * 注意不能复用 getAuth/getCurrentUser：它们经 cookies()/React cache 绑定请
 * 求作用域，心跳回调不在原请求上下文里；这里按 (sessionId, userId) 直查 DB。
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { sessions, users } from "@/db/schema";

export interface SseSessionState {
  /** 会话行仍在且未过期（登出/清除会话 → 行消失） */
  sessionAlive: boolean;
  /** 邮箱已验证（null = 未验证，不允许持有实时流） */
  emailVerified: boolean;
  /** 账号 active 且无生效中的 timed ban */
  notBanned: boolean;
}

/**
 * 纯判定：三条件全真才允许继续持有连接。bannedUntil 语义与 getAuth 对齐
 * —— 未来时间戳 = 封禁生效中（SQL 侧判定，这里只做布尔收敛）。
 */
export function sessionStillValid(state: SseSessionState): boolean {
  return state.sessionAlive && state.emailVerified && state.notBanned;
}

/**
 * 按 (sessionId, userId) 复核会话状态。SQL 复刻 getAuth 的活性条件
 * （expiresAt > now、status = active、timed ban 未生效）+ emailVerifiedAt
 * 非空。查询本身异常时 throw —— 调用侧决定容错（SSE 路由选择保守终止）。
 */
export async function loadSseSessionState(
  userId: string,
  sessionId: string,
): Promise<SseSessionState> {
  // 懒 import：纯判定函数的单测不必拉起 pg 连接池
  const { db } = await import("@/db");
  // 活性条件复刻 getAuth 的 where（会话未过期 + pending2fa 已通过），用户行
  // 状态逐项读回（status/bannedUntil/emailVerifiedAt），会话或用户消失统一收
  // 敛为 sessionAlive=false，由调用侧终止流
  const [row] = await db
    .select({
      emailVerified: sql<boolean>`${users.emailVerifiedAt} IS NOT NULL`,
      notBanned: sql<boolean>`${users.status} = 'active' AND (${users.bannedUntil} IS NULL OR ${users.bannedUntil} < now())`,
    })
    .from(sessions)
    .innerJoin(users, and(eq(users.id, sessions.userId), eq(users.id, userId)))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), eq(sessions.pending2fa, false)))
    .limit(1);
  if (!row) {
    return { sessionAlive: false, emailVerified: false, notBanned: false };
  }
  return {
    sessionAlive: true,
    emailVerified: Boolean(row.emailVerified),
    notBanned: Boolean(row.notBanned),
  };
}
