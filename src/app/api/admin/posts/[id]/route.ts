import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/admin/posts/[id] — permanently remove a post. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [post] = await db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");

    await db.delete(posts).where(eq(posts.id, id));
    await logAdmin(user.id, "post.delete", "post", id, post.title);
    return ok({ ok: true });
  });
}
