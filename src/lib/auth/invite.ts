import { and, eq, isNull, count } from "drizzle-orm";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { randomBytes } from "crypto";
import { applyTierLimits } from "@/lib/tiers";

export const MAX_INVITES_PER_USER = 5;

export function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-");
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
