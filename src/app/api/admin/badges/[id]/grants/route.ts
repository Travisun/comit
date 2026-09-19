import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { extBadgeGrants, extBadges, users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withAdmin } from "@/lib/http";
import { logAdmin } from "@/app/api/admin/_shared";
import { notifyBadgeGranted } from "@/extensions/badges/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function badgeExists(id: string) {
  const [row] = await db.select({ id: extBadges.id, name: extBadges.name }).from(extBadges).where(eq(extBadges.id, id)).limit(1);
  return row ?? null;
}

/** GET /api/admin/badges/[id]/grants — 颁发名单。 */
export async function GET(req: Request, ctx: Ctx) {
  return withAdmin(req, async () => {
    const { id } = await ctx.params;
    const rows = await db
      .select({
        userId: extBadgeGrants.userId,
        username: users.username,
        displayName: users.displayName,
        note: extBadgeGrants.note,
        createdAt: extBadgeGrants.createdAt,
      })
      .from(extBadgeGrants)
      .innerJoin(users, eq(users.id, extBadgeGrants.userId))
      .where(eq(extBadgeGrants.badgeId, id))
      .orderBy(desc(extBadgeGrants.createdAt));
    return ok({ grants: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
  });
}

/** POST /api/admin/badges/[id]/grants — 颁发给指定用户（按用户名），并发通知。 */
export async function POST(req: Request, ctx: Ctx) {
  return withAdmin(req, async ({ user }) => {
    const { id } = await ctx.params;
    const badge = await badgeExists(id);
    if (!badge) throw new AppError("徽章不存在 / Badge not found", 404, "not_found");

    const parsed = z
      .object({ username: z.string().trim().toLowerCase().min(1).max(63), note: z.string().trim().max(200).optional() })
      .safeParse(await jsonBody(req).catch(() => null));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    const [target] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .limit(1);
    if (!target) throw new AppError("用户不存在 / User not found", 404, "not_found");

    const inserted = await db
      .insert(extBadgeGrants)
      .values({ badgeId: id, userId: target.id, grantedBy: user.id, note: parsed.data.note ?? null })
      .onConflictDoNothing({ target: [extBadgeGrants.userId, extBadgeGrants.badgeId] })
      .returning({ id: extBadgeGrants.id });
    if (!inserted.length) {
      throw new AppError("该用户已持有此徽章 / Already granted", 409, "already_granted");
    }
    await logAdmin(user.id, "badge.grant", "badge", id, `→ @${target.username}`);
    await notifyBadgeGranted(target.id, badge.name);
    return ok({ ok: true, grantedTo: target.username });
  });
}

/** DELETE /api/admin/badges/[id]/grants?userId=… — 撤销某用户的徽章。 */
export async function DELETE(req: Request, ctx: Ctx) {
  return withAdmin(req, async ({ user }) => {
    const { id } = await ctx.params;
    const userId = new URL(req.url).searchParams.get("userId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    }
    const rows = await db
      .delete(extBadgeGrants)
      .where(and(eq(extBadgeGrants.badgeId, id), eq(extBadgeGrants.userId, userId)))
      .returning({ id: extBadgeGrants.id });
    if (!rows.length) throw new AppError("未找到颁发记录 / Grant not found", 404, "not_found");
    await logAdmin(user.id, "badge.revoke", "badge", id, `user ${userId}`);
    return ok({ ok: true });
  });
}
