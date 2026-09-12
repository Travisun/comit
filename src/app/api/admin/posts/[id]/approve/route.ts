import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { withAdmin, ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/posts/[id]/approve — publish a post and clear its reject reason. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");

    await db
      .update(posts)
      .set({
        status: "published",
        publishedAt: new Date(),
        rejectReason: null,
        moderation: {
          ...post.moderation,
          reviewedAt: new Date().toISOString(),
          reviewedBy: "admin",
        },
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));

    await logAdmin(user.id, "post.approve", "post", id);
    return ok({ ok: true });
  });
}
