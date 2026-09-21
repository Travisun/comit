import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { assertNotSelfReview, assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().min(1, "请填写驳回原因 / Reason required").max(500),
});

/**
 * POST /api/admin/posts/[id]/reject — mark a post as rejected with a reason.
 * 状态机：仅允许 pending_review → rejected；draft / published / rejected /
 * deleted 均为非法来源 → 409（rejected 后需作者重新提交，再次驳回无意义）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");
    // 利益冲突：editor 不得处置自己的稿件（详见 _shared.assertNotSelfReview）
    assertNotSelfReview(user, post.authorId, { zh: "内容", en: "content" });
    if (post.status !== "pending_review") {
      throw new AppError(
        `文章当前状态为 ${post.status}，仅待审内容可驳回 / Only posts pending review can be rejected`,
        409,
        "invalid_status",
      );
    }

    // 条件更新兜底并发：两个管理员同时审核只成功一次
    const [updated] = await db
      .update(posts)
      .set({
        status: "rejected",
        rejectReason: body.reason,
        moderation: {
          ...post.moderation,
          reviewedAt: new Date().toISOString(),
          reviewedBy: user.id, // 实际操作者，不再是硬编码 "admin"
        },
        updatedAt: new Date(),
      })
      .where(and(eq(posts.id, id), eq(posts.status, "pending_review")))
      .returning({ id: posts.id });
    if (!updated) {
      throw new AppError(
        "文章状态已被并发操作变更 / Post status was changed concurrently",
        409,
        "conflict",
      );
    }

    await logAdmin(user.id, "post.reject", "post", id, body.reason);
    // 人工驳回 → 通知作者（附原因）
    void emit("post:rejected", {
      postId: id,
      authorId: post.authorId,
      reason: body.reason,
      moderatorId: user.id,
    }).catch(() => undefined);
    return ok({ ok: true });
  });
}
