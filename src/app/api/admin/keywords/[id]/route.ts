import { eq } from "drizzle-orm";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/admin/keywords/[id] — remove a keyword from the blacklist. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [row] = await db.delete(keywords).where(eq(keywords.id, id)).returning({ word: keywords.word });
    if (!row) throw notFound("关键词不存在 / Keyword not found");

    await logAdmin(user.id, "keyword.delete", "keyword", id, row.word);
    return ok({ ok: true });
  });
}
