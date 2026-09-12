import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, reports } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";
import { banUser, warnUser } from "@/app/api/admin/users/_moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reports/[id]/action — report-workbench quick actions.
 *
 *   resolve        → mark resolved
 *   dismiss        → mark dismissed
 *   delete_content → soft-remove the reported post/comment, resolves the report
 *   ban_author     → timed (banDays) or permanent ban of the author, resolves the report
 *   warn_author    → warning notice to the author, resolves the report
 *
 * Every branch writes a `report.<action>` row into mod_logs (the shared
 * warn/ban helpers add their own user.* audit rows as well).
 */
const bodySchema = z
  .object({
    action: z.enum(["resolve", "dismiss", "delete_content", "ban_author", "warn_author"]),
    /** ban_author: 1..365 days; omit for a permanent ban */
    banDays: z.number().int().min(1).max(365).optional(),
    /** ban_author: mandatory ban reason; warn_author: fallback for message */
    reason: z.string().trim().min(1).max(500).optional(),
    /** warn_author: the warning message shown to the author */
    message: z.string().trim().min(1).max(500).optional(),
    /** moderator note persisted to mod_logs */
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "ban_author" && !v.reason) {
      ctx.addIssue({ code: "custom", message: "封禁需要填写原因 / Ban reason required" });
    }
    if (v.action === "warn_author" && !v.message && !v.reason) {
      ctx.addIssue({ code: "custom", message: "警告需要填写消息 / Warning message required" });
    }
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const [report] = await db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
      })
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);
    if (!report) throw notFound("举报不存在 / Report not found");

    const note = body.note ?? null;
    const markResolved = () =>
      db.update(reports).set({ status: "resolved" }).where(eq(reports.id, id));

    switch (body.action) {
      case "resolve": {
        await markResolved();
        await logAdmin(user.id, "report.resolve", "report", id, note ?? report.reason);
        return ok({ ok: true, status: "resolved" });
      }
      case "dismiss": {
        await db.update(reports).set({ status: "dismissed" }).where(eq(reports.id, id));
        await logAdmin(user.id, "report.dismiss", "report", id, note ?? report.reason);
        return ok({ ok: true, status: "dismissed" });
      }
      case "delete_content": {
        if (report.targetType === "post") {
          const [post] = await db
            .select({ id: posts.id, authorId: posts.authorId, title: posts.title })
            .from(posts)
            .where(eq(posts.id, report.targetId))
            .limit(1);
          if (!post) throw notFound("被举报文章不存在（可能已删除） / Reported post not found");
          await db
            .update(posts)
            .set({
              status: "rejected",
              rejectReason: note ?? `举报处理：${report.reason}`,
              updatedAt: new Date(),
            })
            .where(eq(posts.id, post.id));
          try {
            await emit("post:rejected", {
              postId: post.id,
              authorId: post.authorId,
              reason: note ?? report.reason,
              moderatorId: user.id,
            });
          } catch (err) {
            console.error("[reports] post:rejected emit failed:", err);
          }
        } else if (report.targetType === "comment") {
          const [c] = await db
            .select({ id: comments.id })
            .from(comments)
            .where(eq(comments.id, report.targetId))
            .limit(1);
          if (!c) throw notFound("被举报评论不存在（可能已删除） / Reported comment not found");
          await db
            .update(comments)
            .set({ status: "deleted" })
            .where(eq(comments.id, c.id));
        } else {
          throw new AppError("用户类型举报没有可删除的内容 / Nothing to delete for user reports", 400);
        }
        await markResolved();
        await logAdmin(
          user.id,
          "report.delete_content",
          report.targetType,
          report.targetId,
          note ?? `举报处置删除内容：${report.reason}`,
        );
        return ok({ ok: true, status: "resolved" });
      }
      case "ban_author": {
        const authorId = await resolveAuthor(report.targetType, report.targetId);
        const days = body.banDays ?? null;
        await banUser({ adminId: user.id, userId: authorId, days, reason: body.reason! });
        await markResolved();
        await logAdmin(
          user.id,
          "report.ban_author",
          report.targetType,
          report.targetId,
          note ?? `举报处置封禁作者（${days ? `${days} 天` : "永久"}）：${body.reason}`,
        );
        return ok({ ok: true, status: "resolved", banned: true, days });
      }
      case "warn_author": {
        const authorId = await resolveAuthor(report.targetType, report.targetId);
        const message = body.message ?? body.reason!;
        await warnUser({ adminId: user.id, userId: authorId, message });
        await markResolved();
        await logAdmin(
          user.id,
          "report.warn_author",
          report.targetType,
          report.targetId,
          note ?? `举报处置警告作者：${message}`,
        );
        return ok({ ok: true, status: "resolved", warned: true });
      }
    }
  });
}

/** Resolve the "author" of a reported object: post/comment author, or the reported user. */
async function resolveAuthor(targetType: string, targetId: string): Promise<string> {
  if (targetType === "user") return targetId;
  if (targetType === "post") {
    const [p] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    if (!p) throw notFound("被举报文章不存在 / Reported post not found");
    return p.authorId;
  }
  const [c] = await db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, targetId))
    .limit(1);
  if (!c) throw notFound("被举报评论不存在 / Reported comment not found");
  return c.userId;
}
