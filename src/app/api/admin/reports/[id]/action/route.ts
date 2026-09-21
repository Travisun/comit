import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, reports, users } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { AppError, conflict, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { assertNotSelfReview, assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";
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
        reporterId: reports.reporterId,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
        status: reports.status,
      })
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);
    if (!report) throw notFound("举报不存在 / Report not found");

    // 利益冲突：editor 不能处置针对**自己内容/自己账号**的举报（自助销案或自助
    // 处置同行 = 绕过审核管线）；admin 例外见 _shared.assertNotSelfReview
    const ownerId = await reportOwner(report.targetType, report.targetId);
    if (ownerId) {
      assertNotSelfReview(user, ownerId, { zh: "举报对象", en: "reported object" });
    }

    const note = body.note ?? null;

    /**
     * 副作用前置定位：内容/作者不存在要在**认领之前**抛出，否则状态已置结案而
     * 处置从未发生。resolve/dismiss 不定位（被举报内容可能早已被删，仍须能结案）。
     */
    const content =
      body.action === "delete_content"
        ? await locateContent(report.targetType, report.targetId)
        : null;
    const targetAuthorId =
      body.action === "ban_author" || body.action === "warn_author"
        ? await resolveAuthor(report.targetType, report.targetId)
        : null;

    /**
     * 原子认领（重放/并发防护）：`UPDATE … WHERE status='open' RETURNING` 用单
     * 语句完成「判未处理 + 置为结案」。此前是先 select 再无条件 update + 副作用，
     * 同一 report id 重复投递（双击、前端重放、两个管理页并发打开、被抓包的请求
     * 重放）会让每个请求都跑完整副作用：重复封禁（续期 + 再次清空会话）、重复
     * 警告与通知、mod_logs 成倍膨胀、open 计数虚高。
     * 认领即写终态，故后续分支不再各自 markResolved。
     */
    const nextStatus = body.action === "dismiss" ? "dismissed" : "resolved";
    const [claimed] = await db
      .update(reports)
      .set({ status: nextStatus })
      .where(and(eq(reports.id, id), eq(reports.status, "open")))
      .returning({ id: reports.id });
    if (!claimed) {
      throw new AppError("该举报已被处理 / Report already handled", 409, "report_closed");
    }

    /** 举报处理完毕 → 通知举报人处理结果（best-effort，失败仅记日志） */
    const notifyReporter = (outcome: "resolved" | "dismissed", action: string) => {
      void emit("report:resolved", {
        reportId: id,
        reporterId: report.reporterId,
        outcome,
        action,
        targetType: report.targetType,
        reason: note ?? report.reason,
      }).catch((err: unknown) => console.error("[reports] report:resolved emit failed:", err));
    };

    switch (body.action) {
      case "resolve": {
        await logAdmin(user.id, "report.resolve", "report", id, note ?? report.reason);
        notifyReporter("resolved", "resolve");
        return ok({ ok: true, status: "resolved" });
      }
      case "dismiss": {
        await logAdmin(user.id, "report.dismiss", "report", id, note ?? report.reason);
        notifyReporter("dismissed", "dismiss");
        return ok({ ok: true, status: "dismissed" });
      }
      case "delete_content": {
        const located = content!; // delete_content 必然已定位（未定位在认领前即 404/400）
        if (located.kind === "post") {
          // 状态前置：只处置「仍可回到公开面」的行。回收站里的文章（status
          // ='deleted'）不得被举报处置顺手改成 rejected —— 那会让它脱离回收站
          // （还原要求 status='deleted'）又从未公开，成为不可恢复的僵尸行。
          const [removed] = await db
            .update(posts)
            .set({
              status: "rejected",
              rejectReason: note ?? `举报处理：${report.reason}`,
              updatedAt: new Date(),
            })
            .where(
              and(eq(posts.id, located.id), inArray(posts.status, ["published", "pending_review", "draft"])),
            )
            .returning({ id: posts.id });
          if (!removed) {
            throw conflict("被举报文章当前状态不可处置（可能已在回收站）/ Reported post is not actionable");
          }
          try {
            await emit("post:rejected", {
              postId: located.id,
              authorId: located.authorId,
              reason: note ?? report.reason,
              moderatorId: user.id,
            });
          } catch (err) {
            console.error("[reports] post:rejected emit failed:", err);
          }
        } else {
          await db
            .update(comments)
            .set({ status: "deleted" })
            .where(eq(comments.id, located.id));
          // 评论被举报删除 → 通知评论作者（post:rejected 的评论侧对应物）
          try {
            await emit("comment:removed", {
              commentId: located.id,
              postId: located.postId,
              authorId: located.authorId,
              reason: note ?? report.reason,
              by: "report",
            });
          } catch (err) {
            console.error("[reports] comment:removed emit failed:", err);
          }
        }
        await logAdmin(
          user.id,
          "report.delete_content",
          report.targetType,
          report.targetId,
          note ?? `举报处置删除内容：${report.reason}`,
        );
        notifyReporter("resolved", "delete_content");
        return ok({ ok: true, status: "resolved" });
      }
      case "ban_author": {
        const authorId = targetAuthorId!; // ban/warn 必然已定位
        const days = body.banDays ?? null;
        // 权限对称闸口：admin.moderate 含 editor，但「永久封禁」与「封禁管理
        // 成员」在 /api/admin/users/[id] 是 admin-only —— 工作台不得成为绕过
        // 该门槛的旁路（被钓鱼的 editor 账号不能永久删除任意用户/管理员）
        if (days === null || (await isStaffUser(authorId))) {
          if (user.role !== "admin") {
            throw forbidden("永久封禁或封禁管理成员仅限管理员 / Only admins may permanently ban or ban staff");
          }
        }
        await banUser({ adminId: user.id, userId: authorId, days, reason: body.reason! });
        await logAdmin(
          user.id,
          "report.ban_author",
          report.targetType,
          report.targetId,
          note ?? `举报处置封禁作者（${days ? `${days} 天` : "永久"}）：${body.reason}`,
        );
        notifyReporter("resolved", "ban_author");
        return ok({ ok: true, status: "resolved", banned: true, days });
      }
      case "warn_author": {
        const authorId = targetAuthorId!; // ban/warn 必然已定位
        const message = body.message ?? body.reason!;
        await warnUser({ adminId: user.id, userId: authorId, message });
        await logAdmin(
          user.id,
          "report.warn_author",
          report.targetType,
          report.targetId,
          note ?? `举报处置警告作者：${message}`,
        );
        notifyReporter("resolved", "warn_author");
        return ok({ ok: true, status: "resolved", warned: true });
      }
    }
  });
}

/** 目标是管理成员（admin/非普通角色）？举报工作台的封禁权限对称闸口用。 */
async function isStaffUser(userId: string): Promise<boolean> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return !!u && u.role !== "user";
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

/**
 * 举报对象的归属人（COI 判定用）：目标行已不存在时返回 null（无从判定，
 * 交由后续 locate/resolveAuthor 的 404 处理）。
 */
async function reportOwner(targetType: string, targetId: string): Promise<string | null> {
  if (targetType === "user") return targetId;
  if (targetType === "post") {
    const [p] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    return p?.authorId ?? null;
  }
  const [c] = await db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, targetId))
    .limit(1);
  return c?.userId ?? null;
}

type LocatedContent =
  | { kind: "post"; id: string; authorId: string }
  | { kind: "comment"; id: string; postId: string; authorId: string };

/** delete_content 的定位：user 类型无可删内容（400），目标行已删则 404。 */
async function locateContent(targetType: string, targetId: string): Promise<LocatedContent> {
  if (targetType === "post") {
    const [p] = await db
      .select({ id: posts.id, authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    if (!p) throw notFound("被举报文章不存在（可能已删除） / Reported post not found");
    return { kind: "post", ...p };
  }
  if (targetType === "comment") {
    const [c] = await db
      .select({ id: comments.id, postId: comments.postId, userId: comments.userId })
      .from(comments)
      .where(eq(comments.id, targetId))
      .limit(1);
    if (!c) throw notFound("被举报评论不存在（可能已删除） / Reported comment not found");
    return { kind: "comment", id: c.id, postId: c.postId, authorId: c.userId };
  }
  throw new AppError("用户类型举报没有可删除的内容 / Nothing to delete for user reports", 400);
}
