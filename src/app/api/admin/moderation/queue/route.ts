import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { withAdmin, ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { truncate } from "@/lib/utils";
import { pagination } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/moderation/queue?limit=20 — posts waiting for manual review (FIFO). */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const { limit } = pagination(url);

    const items = await db
      .select({
        id: posts.id,
        title: posts.title,
        summary: posts.summary,
        content: posts.content,
        type: posts.type,
        createdAt: posts.createdAt,
        moderation: posts.moderation,
        rejectReason: posts.rejectReason,
        author: { username: users.username, displayName: users.displayName },
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.status, "pending_review"))
      .orderBy(asc(posts.createdAt))
      .limit(Math.min(limit, 50));

    return ok({
      items: items.map((p) => ({ ...p, content: truncate(p.content, 500) })),
    });
  });
}
