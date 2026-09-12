import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { sendOperationNotification } from "@/lib/operation-notify";
import { logAdmin } from "@/app/api/admin/_shared";

/**
 * Shared user-moderation service used by both the user management API
 * (PATCH /api/admin/users/[id]) and the report workbench quick actions
 * (POST /api/admin/reports/[id]/action).
 *
 * Every action follows the same discipline:
 *   1. DB state change (+ audit row in mod_logs)
 *   2. domain event emit (user:warned / user:banned / user:unbanned)
 *   3. operation notification to the affected user
 * Steps 2 and 3 are best-effort: a failing webhook or mail channel must
 * never roll back the moderation action itself.
 */

export type ModerationTarget = {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "suspended" | "deleted";
  bannedUntil: Date | null;
  banReason: string | null;
};

export async function getModerationTarget(userId: string): Promise<ModerationTarget> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      status: users.status,
      bannedUntil: users.bannedUntil,
      banReason: users.banReason,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw notFound("用户不存在 / User not found");
  return row;
}

function formatUntil(d: Date, locale: "zh" | "en"): string {
  return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Best-effort side effects: emit the domain event, then notify the user. */
async function sideEffects(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[moderation] side effect failed:", err);
  }
}

/* ------------------------------- warn ----------------------------------- */

export async function warnUser(opts: {
  adminId: string;
  userId: string;
  message: string;
}): Promise<void> {
  const target = await getModerationTarget(opts.userId);

  await logAdmin(opts.adminId, "user.warn", "user", target.id, opts.message);

  await sideEffects(() =>
    emit("user:warned", { userId: target.id, message: opts.message, byAdminId: opts.adminId }),
  );
  await sideEffects(() =>
    sendOperationNotification(target.id, {
      key: "system.warn",
      title: { zh: "你收到了一条管理警告", en: "You received a moderator warning" },
      body: { zh: opts.message, en: opts.message },
      payload: { username: target.username },
    }),
  );
}

/* -------------------------------- ban ----------------------------------- */

/**
 * Timed ban (`days` 1..365) or permanent ban (`days === null`).
 * Suspends the account, wipes every session (immediate kick-out) and
 * records reason + bannedUntil on the user row.
 */
export async function banUser(opts: {
  adminId: string;
  userId: string;
  /** null ⇒ permanent ban */
  days: number | null;
  reason: string;
}): Promise<{ bannedUntil: Date | null }> {
  const target = await getModerationTarget(opts.userId);

  const bannedUntil =
    opts.days === null ? null : new Date(Date.now() + Math.round(opts.days) * 86400_000);

  await db
    .update(users)
    .set({ status: "suspended", bannedUntil, banReason: opts.reason })
    .where(eq(users.id, target.id));

  // kick out everywhere: the session gate re-checks bannedUntil on every request,
  // but deleting rows guarantees no lingering credentials.
  await db.delete(sessions).where(eq(sessions.userId, target.id));

  const action = bannedUntil ? "user.ban_timed" : "user.ban_permanent";
  const note = bannedUntil
    ? `${opts.days} 天，至 ${formatUntil(bannedUntil, "zh")}；原因：${opts.reason}`
    : `永久；原因：${opts.reason}`;
  await logAdmin(opts.adminId, action, "user", target.id, `(@${target.username}) ${note}`);

  await sideEffects(() =>
    emit("user:banned", {
      userId: target.id,
      bannedUntil: bannedUntil ? bannedUntil.toISOString() : null,
      reason: opts.reason,
      byAdminId: opts.adminId,
    }),
  );
  await sideEffects(() =>
    sendOperationNotification(
      target.id,
      bannedUntil
        ? {
            key: "system.ban",
            title: {
              zh: `你的账号已被封禁 ${opts.days} 天`,
              en: `Your account has been banned for ${opts.days} days`,
            },
            body: {
              zh: `原因：${opts.reason}；解封时间：${formatUntil(bannedUntil, "zh")}`,
              en: `Reason: ${opts.reason}; unban at ${formatUntil(bannedUntil, "en")}`,
            },
            payload: { username: target.username, days: opts.days },
          }
        : {
            key: "system.ban",
            title: { zh: "你的账号已被永久封禁", en: "Your account has been permanently banned" },
            body: {
              zh: `原因：${opts.reason}（永久封禁，不会自动解除，如有异议请联系管理员）`,
              en: `Reason: ${opts.reason} (permanent, contact the administrators to appeal)`,
            },
            payload: { username: target.username, days: null },
          },
    ),
  );

  return { bannedUntil };
}

/* ------------------------------- unban ---------------------------------- */

export async function unbanUser(opts: { adminId: string; userId: string }): Promise<void> {
  const target = await getModerationTarget(opts.userId);

  await db
    .update(users)
    .set({ status: "active", bannedUntil: null, banReason: null })
    .where(eq(users.id, target.id));

  await logAdmin(opts.adminId, "user.unban", "user", target.id, `(@${target.username}) 解封`);

  await sideEffects(() => emit("user:unbanned", { userId: target.id, byAdminId: opts.adminId }));
  await sideEffects(() =>
    sendOperationNotification(target.id, {
      key: "system.unban",
      title: { zh: "你的账号已解封", en: "Your account has been unbanned" },
      body: {
        zh: "账号已恢复正常使用，欢迎回来继续创作。",
        en: "Your account is active again. Welcome back!",
      },
      payload: { username: target.username },
    }),
  );
}
