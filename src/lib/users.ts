/**
 * 用户名领域逻辑 — 查库可用性/交互校验/工具函数。
 * 规则常量、保留字与纯格式校验的单一来源在 src/lib/username-policy.ts
 * （与 src/proxy.ts 共享，勿在此处再复制一份清单）。
 */
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { follows, users, blocks } from "@/db/schema";
import { conflict, forbidden, notFound } from "@/core/errors";
import {
  RESERVED_USERNAMES,
  USERNAME_MAX,
  USERNAME_MIN,
  checkUsernameFormat,
  isValidUsername,
  type UsernameCheck,
} from "./username-policy";

// 单一来源 re-export：既有调用方（settings/_data、api/me/username 等）与
// 新代码统一从此导入；proxy.ts 直接导入 username-policy（纯模块，无 db 依赖）。
export { RESERVED_USERNAMES, USERNAME_MAX, USERNAME_MIN, checkUsernameFormat, isValidUsername };
export type { UsernameCheck };

/** 改名冷却期（天）：防止频繁改名造成外链与 @ 引用大面积失效 */
export const USERNAME_COOLDOWN_DAYS = 30;

/** 完整可用性检查：格式 → 保留字 → 占用（改名路径走这一套）。 */
export async function checkUsernameAvailable(raw: string): Promise<UsernameCheck> {
  const fmt = checkUsernameFormat(raw);
  if (!fmt.ok) return fmt;
  const u = raw.trim().toLowerCase();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, u))
    .limit(1);
  if (row) return { ok: false, reason: "该用户名已被占用 / Username already taken" };
  return { ok: true };
}

export function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && RESERVED_USERNAMES.has(s) === false;
}

export async function assertUsernameAvailable(username: string) {
  if (!isValidUsername(username)) {
    throw conflict("用户名不可用（仅小写字母、数字、连字符）/ Username unavailable");
  }
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (row) throw conflict("用户名已被占用 / Username taken");
}


export async function assertNotBlocked(a: string, b: string) {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
      and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
    ))
    .limit(1);
  if (row) throw forbidden("该操作被阻止 / This interaction is blocked");
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1);
  return Boolean(row);
}

export async function getUserByUsername(username: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, "active")))
    .limit(1);
  if (!user) throw notFound("用户不存在 / User not found");
  return user;
}
