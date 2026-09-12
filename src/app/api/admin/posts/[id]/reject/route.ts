import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { withAdmin, ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { notFound } from "@/core/errors";
import { assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().min(1, "请填写驳回原因 / Reason required").max(500),
});

/** POST /api/admin/posts/[id]/reject — mark a post as rejected with a reason. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.moderate", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound("文章不存在 / Post not found");

    await db
      .update(posts)
      .set({
        status: "rejected",
        rejectReason: body.reason,
        moderation: {
          ...post.moderation,
          reviewedAt: new Date().toISOString(),
          reviewedBy: "admin",
        },
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));

    await logAdmin(user.id, "post.reject", "post", id, body.reason);
    return ok({ ok: true });
  });
}
