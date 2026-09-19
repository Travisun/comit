import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { extBadges } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withAdmin } from "@/lib/http";
import { logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  text: z.string().trim().min(1).max(24).optional(),
  description: z.string().trim().max(200).nullish(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/** PATCH /api/admin/badges/[id] — 编辑徽章（名称/文字/说明/启停/排序）。 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withAdmin(req, async ({ user }) => {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await jsonBody(req).catch(() => null));
    const [row] = await db
      .update(extBadges)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.description !== undefined
          ? { description: body.description === null ? null : body.description }
          : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      })
      .where(eq(extBadges.id, id))
      .returning({ id: extBadges.id, key: extBadges.key });
    if (!row) throw new AppError("徽章不存在 / Badge not found", 404, "not_found");
    await logAdmin(user.id, "badge.update", "badge", id, row.key);
    return ok({ ok: true });
  });
}

/** DELETE /api/admin/badges/[id] — 删除徽章（颁发与佩戴记录级联清除）。 */
export async function DELETE(req: Request, ctx: Ctx) {
  return withAdmin(req, async ({ user }) => {
    const { id } = await ctx.params;
    const rows = await db.delete(extBadges).where(eq(extBadges.id, id)).returning({ key: extBadges.key });
    if (!rows.length) throw new AppError("徽章不存在 / Badge not found", 404, "not_found");
    await logAdmin(user.id, "badge.delete", "badge", id, rows[0].key);
    return ok({ ok: true });
  });
}
