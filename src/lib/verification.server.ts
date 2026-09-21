import "server-only";

import { and, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { media, users, verificationRequests } from "@/db/schema";
import { conflict, forbidden, notFound } from "@/core/errors";
import {
  createVerificationRequestSchema,
  type AdminVerificationRequestView,
  type CreateVerificationRequestInput,
  type VerificationBadge,
  type VerificationRequestStatus,
  type VerificationRequestView,
  type VerificationType,
} from "./verification";
import { escapeLikePattern } from "@/lib/utils";
import { withAdvisoryLock } from "@/lib/pg-lock";

/**
 * db-backed half of the verification domain (the pure constants live in
 * `./verification`). Review mutations run in a transaction so the request
 * row and the `users.verified` badge flip atomically.
 */

type RequestRow = typeof verificationRequests.$inferSelect;

function toView(row: RequestRow): VerificationRequestView {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    description: row.description,
    attachments: row.attachments ?? [],
    status: row.status as VerificationRequestStatus,
    rejectReason: row.rejectReason,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------- reads ----------------------------------- */

/** The user's currently approved badge (users.verified), or null. */
export async function getUserVerification(userId: string): Promise<VerificationBadge | null> {
  const [row] = await db
    .select({ verified: users.verified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.verified ?? null;
}

/** Global number of pending requests (admin dashboard counters). */
export async function getPendingCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(verificationRequests)
    .where(eq(verificationRequests.status, "pending"));
  return row?.n ?? 0;
}

/** My recent requests, newest first. */
export async function listMyRequests(userId: string, limit = 5): Promise<VerificationRequestView[]> {
  const rows = await db
    .select()
    .from(verificationRequests)
    .where(eq(verificationRequests.userId, userId))
    .orderBy(desc(verificationRequests.createdAt))
    .limit(limit);
  return rows.map(toView);
}

/** Review console listing with applicant identity join + keyword search. */
export async function listRequests({
  status,
  q,
  limit = 25,
  offset = 0,
}: {
  status?: VerificationRequestStatus;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminVerificationRequestView[]; total: number }> {
  const conds: SQL[] = [];
  if (status) conds.push(eq(verificationRequests.status, status));
  const kw = q?.trim();
  if (kw) {
    const like = `%${escapeLikePattern(kw)}%`;
    conds.push(
      or(
        ilike(users.username, like),
        ilike(users.displayName, like),
        ilike(verificationRequests.label, like),
      ) as SQL,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const [items, [totalRow]] = await Promise.all([
    db
      .select({
        request: verificationRequests,
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
        tier: users.tier,
        verified: users.verified,
      })
      .from(verificationRequests)
      .innerJoin(users, eq(users.id, verificationRequests.userId))
      .where(where)
      .orderBy(desc(verificationRequests.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(verificationRequests)
      .innerJoin(users, eq(users.id, verificationRequests.userId))
      .where(where),
  ]);

  return {
    items: items.map((r) => ({
      ...toView(r.request),
      userId: r.request.userId,
      user: {
        username: r.username,
        displayName: r.displayName,
        avatarPath: r.avatarPath,
        tier: r.tier,
        verified: r.verified ?? null,
      },
    })),
    total: totalRow?.n ?? 0,
  };
}

/* ------------------------------- writes ---------------------------------- */

/**
 * 利益冲突闸口：审核人不得处置**自己**提交的认证申请（非 admin）。
 *
 * admin 例外是单人运营形态的必然结果（管理员自己就是申请人兼审核人），且 admin
 * 本就握有全部权限，不构成提权；editor 持有的是被授予的 admin.verification，用它
 * 给自己签发 `users.verified` 蓝标 = 绕过认证流程，必须拒绝。
 */
export async function assertReviewerNotApplicant(
  requestId: string,
  reviewer: { id: string; role: string },
): Promise<void> {
  const [row] = await db
    .select({ userId: verificationRequests.userId })
    .from(verificationRequests)
    .where(eq(verificationRequests.id, requestId))
    .limit(1);
  if (!row) throw notFound("认证申请不存在 / Verification request not found");
  if (row.userId === reviewer.id && reviewer.role !== "admin") {
    throw forbidden("不能审核自己的认证申请 / You cannot review your own verification request");
  }
}

/**
 * Submit a new request. Rejects when a pending request already exists and
 * validates that every attachment path belongs to the user's media library.
 */
export async function createVerificationRequest(
  userId: string,
  input: CreateVerificationRequestInput,
): Promise<VerificationRequestView> {
  createVerificationRequestSchema.parse(input);

  // 检查 + 插入放在同一把用户级锁的临界区里：并发双提原先可各自通过 pending 检查
  // 而留下两条待审申请（同一身份被批出两条 approved 锚点）。schema 上的部分唯一
  // 索引 verification_one_pending_key 是硬护栏，onConflictDoNothing 把它转成业务错误。
  const row = await withAdvisoryLock(`verification:${userId}`, async (tx) => {
    const [pending] = await tx
      .select({ id: verificationRequests.id })
      .from(verificationRequests)
      .where(and(eq(verificationRequests.userId, userId), eq(verificationRequests.status, "pending")))
      .limit(1);
    if (pending) {
      throw conflict("已有待审核的认证申请 / A pending verification request already exists");
    }

    // attachments must be rows of the caller's own media library
    const owned = await tx
      .select({ path: media.path })
      .from(media)
      .where(and(eq(media.userId, userId), inArray(media.path, input.attachments)));
    if (owned.length !== new Set(input.attachments).size) {
      throw conflict("附件不存在或不属于你的媒体库 / Attachments must come from your media library");
    }

    const [created] = await tx
      .insert(verificationRequests)
      .values({
        userId,
        type: input.type as VerificationType,
        label: input.label,
        description: input.description,
        attachments: input.attachments,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw conflict("已有待审核的认证申请 / A pending verification request already exists");
    }
    return created;
  });
  return toView(row);
}

/** Withdraw my own pending request (row is removed). */
export async function withdrawRequest(userId: string, requestId: string): Promise<void> {
  const rows = await db
    .delete(verificationRequests)
    .where(
      and(
        eq(verificationRequests.id, requestId),
        eq(verificationRequests.userId, userId),
        eq(verificationRequests.status, "pending"),
      ),
    )
    .returning({ id: verificationRequests.id });
  if (rows.length === 0) throw notFound("申请不存在或不可撤回 / Request not found or not withdrawable");
}

/**
 * Approve a pending request: flips the row to `approved` and writes
 * `users.verified = { type, label, approvedAt }` in one transaction.
 * Returns the updated request (caller emits events / sends notifications).
 */
export async function approveRequest(
  requestId: string,
  reviewerId: string,
): Promise<VerificationRequestView & { userId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.id, requestId))
      .limit(1)
      .for("update");
    if (!row) throw notFound("认证申请不存在 / Verification request not found");
    if (row.status !== "pending") {
      throw conflict("该申请已被处理 / This request has already been reviewed");
    }

    const now = new Date();
    const [updated] = await tx
      .update(verificationRequests)
      .set({ status: "approved", reviewedBy: reviewerId, reviewedAt: now })
      .where(eq(verificationRequests.id, requestId))
      .returning();

    await tx
      .update(users)
      .set({
        verified: { type: row.type, label: row.label, approvedAt: now.toISOString() },
        updatedAt: now,
      })
      .where(eq(users.id, row.userId));

    return { ...toView(updated), userId: row.userId };
  });
}

/**
 * Reject a pending request with a reason. The user's existing badge (if any)
 * is left untouched — rejection only closes the pending request.
 */
export async function rejectRequest(
  requestId: string,
  reviewerId: string,
  reason: string,
): Promise<VerificationRequestView & { userId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.id, requestId))
      .limit(1)
      .for("update");
    if (!row) throw notFound("认证申请不存在 / Verification request not found");
    if (row.status !== "pending") {
      throw conflict("该申请已被处理 / This request has already been reviewed");
    }

    const [updated] = await tx
      .update(verificationRequests)
      .set({
        status: "rejected",
        rejectReason: reason.slice(0, 300),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      })
      .where(eq(verificationRequests.id, requestId))
      .returning();

    return { ...toView(updated), userId: row.userId };
  });
}

/**
 * Revoke an already-approved verification: clears `users.verified` and keeps
 * the request row (still `approved`) as the audit anchor.
 */
export async function revokeVerification(
  requestId: string,
  reviewerId: string,
): Promise<VerificationRequestView & { userId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.id, requestId))
      .limit(1)
      .for("update");
    if (!row) throw notFound("认证申请不存在 / Verification request not found");
    if (row.status !== "approved") {
      throw conflict("只能撤销已通过的认证 / Only approved verifications can be revoked");
    }

    // the badge itself is the revoke guard — a second revoke must not re-notify
    const [user] = await tx
      .select({ verified: users.verified })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1)
      .for("update");
    if (!user?.verified) {
      throw conflict("该认证已被撤销 / This verification has already been revoked");
    }

    await tx
      .update(users)
      .set({ verified: null, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    // remember who revoked it on the request row
    await tx
      .update(verificationRequests)
      .set({ reviewedBy: reviewerId })
      .where(eq(verificationRequests.id, requestId));

    return { ...toView(row), userId: row.userId };
  });
}
