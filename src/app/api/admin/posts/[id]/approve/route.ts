import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { AppError, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { assertNotSelfReview, assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/posts/[id]/approve — publish a post and clear its reject reason.
 * 状态机（post_status = draft | pending_review | published | rejected | deleted）：
 *   仅允许 pending_review → published；draft / rejected 需作者重新提交，
 *   published / deleted 为非法来源 → 409。publishedAt 只在首次发布语义下写入。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");
    // 利益冲突：editor 不能放行自己的稿件（对所有用户生效的审核管线不能被
    // 被授予的审核权绕过）；admin 单人运营时自审是主流程，见 _shared 注释
    assertNotSelfReview(user, post.authorId, { zh: "内容", en: "content" });
    if (post.status !== "pending_review") {
      throw new AppError(
        `文章当前状态为 ${post.status}，仅待审内容可通过审核 / Only posts pending review can be approved`,
        409,
        "invalid_status",
      );
    }

    // 条件更新兜底并发：两个管理员同时审核只成功一次
    const [updated] = await db
      .update(posts)
      .set({
        status: "published",
        // 首次发布语义：仅在尚无发布时间时写入，重复触发不重置
        publishedAt: post.publishedAt ?? new Date(),
        rejectReason: null,
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

    await logAdmin(user.id, "post.approve", "post", id);
    // 人工过审 → 通知作者（与自动审核管线 moderation:review.completed 对齐）
    void emit("post:approved", { postId: id, authorId: post.authorId, moderatorId: user.id })
      .catch(() => undefined);
    return ok({ ok: true });
  });
}
