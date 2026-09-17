import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { modLogs, users } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { optionalUuid, pagination } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit?action=&adminId=&limit=40&offset=
 * Read-only mod_logs stream (newest first) with the acting admin joined in.
 * adminId 可为 null（系统 actor 的审计行），故用 leftJoin 而非 innerJoin。
 * Also returns the distinct action list for the filter dropdown.
 */
export async function GET(req: Request) {
  return withPermission(req, "admin.audit", async () => {
    const url = new URL(req.url);
    const { limit, offset } = pagination(url);
    const action = (url.searchParams.get("action") ?? "").trim();
    // 非法 UUID 直接 400，避免垃圾值打穿 drizzle eq(uuid) 变 PG 500
    const adminId = optionalUuid(url, "adminId");

    const conds: SQL[] = [];
    if (action) conds.push(eq(modLogs.action, action));
    if (adminId) conds.push(eq(modLogs.adminId, adminId));
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ n: total }], actionRows] = await Promise.all([
      db
        .select({
          id: modLogs.id,
          action: modLogs.action,
          targetType: modLogs.targetType,
          targetId: modLogs.targetId,
          note: modLogs.note,
          createdAt: modLogs.createdAt,
          adminId: modLogs.adminId,
          adminUsername: users.username,
          adminDisplayName: users.displayName,
          adminAvatar: users.avatarPath,
        })
        .from(modLogs)
        .leftJoin(users, eq(users.id, modLogs.adminId))
        .where(where)
        .orderBy(desc(modLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(modLogs).where(where),
      db
        .select({
          action: modLogs.action,
          n: count(),
        })
        .from(modLogs)
        .groupBy(modLogs.action)
        .orderBy(desc(count()))
        .limit(60),
    ]);

    // resolve /u/{username} links for user-target rows in one batch
    const userTargets = [
      ...new Set(
        rows.filter((r) => r.targetType === "user" && r.targetId).map((r) => r.targetId!),
      ),
    ];
    const usernameMap = new Map<string, string>();
    if (userTargets.length) {
      const userRows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, userTargets));
      userRows.forEach((u) => usernameMap.set(u.id, u.username));
    }

    const items = rows.map((r) => ({
      ...r,
      targetUsername: r.targetType === "user" ? (usernameMap.get(r.targetId ?? "") ?? null) : null,
    }));

    return ok({
      items,
      total,
      actions: actionRows.map((r) => ({ action: r.action, count: Number(r.n) })),
    });
  });
}
