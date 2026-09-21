import { and, eq, isNull, count } from "drizzle-orm";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { randomBytes } from "crypto";
import { applyTierLimits } from "@/lib/tiers";

export const MAX_INVITES_PER_USER = 5;

/**
 * 邀请码形状：16 位十六进制（大写），即 8 字节 = **64 位熵**。
 *
 * WHY：旧实现是 4 字节（32 位）+ 连字符分组。邀请码虽经 consumeInvite/注册事务
 * 里的 `UPDATE … WHERE used_at IS NULL` 原子单次消费，但 32 位空间可被「轮换
 * IP + 注册端点」离线式穷举 —— 在邀请制站点上后果是提前烧毁他人未使用的邀请
 * 码（占位/骚扰），故把猜测成本抬到 2^64（配合 auth.register 桶的按 IP 限流，
 * 现实不可行）。上限受 invites.code varchar(16) 约束：不加列宽迁移就不可能到
 * 128 位，故取当前列宽允许的最大熵；分组连字符同样为长度让路（显示改为整体
 * 十六进制串，输入侧统一 toUpperCase 归一）。
 */
export function generateInviteCode(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

export async function createInvite(userId: string): Promise<string> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(invites)
    .where(and(eq(invites.createdBy, userId), isNull(invites.usedBy)));
  // per-tier invite quota (VIP1 free = 5; future tiers hook in via tiers.ts)
  const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
  const maxInvites = applyTierLimits(u?.tier ?? 1).maxInvites;
  if (n >= maxInvites) throw forbidden(`最多生成 ${maxInvites} 个邀请码 / Invite limit reached`);
  const code = generateInviteCode();
  await db.insert(invites).values({ code, createdBy: userId });
  return code;
}

/** Validate an invite code; returns inviter id or null. */
export async function consumeInvite(code: string | undefined | null): Promise<string | null> {
  if (!code) return null;
  const [row] = await db
    .update(invites)
    .set({ usedAt: new Date() })
    .where(and(eq(invites.code, code.trim().toUpperCase()), isNull(invites.usedAt)))
    .returning({ createdBy: invites.createdBy, id: invites.id });
  if (!row) return null;
  return row.createdBy;
}

export async function markInviteUsed(code: string, newUserId: string) {
  await db.update(invites).set({ usedBy: newUserId }).where(eq(invites.code, code));
}

export async function listInvites(userId: string) {
  return db.select().from(invites).where(eq(invites.createdBy, userId)).orderBy(invites.createdAt);
}

export async function usernameTaken(username: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return Boolean(row);
}
