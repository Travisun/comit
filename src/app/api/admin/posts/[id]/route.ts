import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { conflict, notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/posts/[id] — permanently remove a post (admin only).
 *
 * 破坏性分级：审核台日常动作（通过/驳回）editor 可执行，物理删除会 cascade 掉
 * 评论/点赞/投票且不可恢复，因此 ① 权限收紧到 admin，② 必须先经回收站
 * （status='deleted'）—— 与作者侧「软删 → 还原/彻底删除」的两段式一致，
 * 任何一次误点都不会直接丢数据。
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.posts.purge", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [post] = await db
      .select({ id: posts.id, title: posts.title, status: posts.status })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");
    if (post.status !== "deleted") {
      throw conflict("只能彻底删除回收站中的文章 / Only posts in the recycle bin can be purged");
    }

    await db.delete(posts).where(eq(posts.id, post.id));
    await logAdmin(user.id, "post.purge", "post", id, post.title);
    return ok({ ok: true });
  });
}
