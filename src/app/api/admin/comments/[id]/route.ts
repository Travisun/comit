import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { withAdmin, ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["visible", "hidden"]),
});

/** PATCH /api/admin/comments/[id] — hide or restore a comment. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(patchSchema, await jsonBody(req));

    const [row] = await db
      .update(comments)
      .set({ status: body.status })
      .where(eq(comments.id, id))
      .returning({ id: comments.id });
    if (!row) throw notFound("评论不存在 / Comment not found");

    await logAdmin(
      user.id,
      body.status === "hidden" ? "comment.hide" : "comment.restore",
      "comment",
      id,
    );
    return ok({ ok: true, status: body.status });
  });
}

/** DELETE /api/admin/comments/[id] — soft-delete (status = 'deleted'). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [row] = await db
      .update(comments)
      .set({ status: "deleted" })
      .where(eq(comments.id, id))
      .returning({ id: comments.id });
    if (!row) throw notFound("评论不存在 / Comment not found");

    await logAdmin(user.id, "comment.delete", "comment", id);
    return ok({ ok: true });
  });
}
