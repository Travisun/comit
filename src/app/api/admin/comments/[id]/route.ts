import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { publishComment } from "@/lib/moderation";
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

    const [current] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!current) throw notFound("评论不存在 / Comment not found");

    // 审核态 → visible 走人工过审管线（计数 +1 + comment:created 通知），
    // 避免「状态改了但计数/通知没跟上」的漂移。
    if (body.status === "visible" && (current.status === "pending_review" || current.status === "rejected")) {
      await publishComment(current, { reviewedBy: "manual" });
      await logAdmin(user.id, "comment.approve", "comment", id);
      return ok({ ok: true, status: body.status });
    }

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

    const [current] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!current) throw notFound("评论不存在 / Comment not found");

    await db
      .update(comments)
      .set({ status: "deleted" })
      .where(eq(comments.id, id));

    await logAdmin(user.id, "comment.delete", "comment", id);
    // 评论被管理员删除 → 通知评论作者（best-effort）
    void emit("comment:removed", {
      commentId: id,
      postId: current.postId,
      authorId: current.userId,
      by: "admin",
    }).catch(() => undefined);
    return ok({ ok: true });
  });
}
