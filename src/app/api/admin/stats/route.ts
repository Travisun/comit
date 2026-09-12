import { count, desc, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, reports, users } from "@/db/schema";
import { withAdmin, ok } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { pendingReviewCount } from "@/lib/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/stats — dashboard overview numbers + recent activity. */
export async function GET(req: Request) {
  return withPermission(req, "admin.dashboard", async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      [{ n: totalUsers }],
      [{ n: newUsersToday }],
      [{ n: totalPosts }],
      [{ n: totalComments }],
      [{ n: openReports }],
      pendingPosts,
      recentUsers,
      recentPosts,
    ] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(users).where(gte(users.createdAt, startOfDay)),
      db.select({ n: count() }).from(posts),
      db.select({ n: count() }).from(comments).where(ne(comments.status, "deleted")),
      db.select({ n: count() }).from(reports).where(eq(reports.status, "open")),
      pendingReviewCount(),
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarPath: users.avatarPath,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(10),
      db
        .select({
          id: posts.id,
          title: posts.title,
          type: posts.type,
          status: posts.status,
          publishedAt: posts.publishedAt,
          createdAt: posts.createdAt,
          author: { username: users.username, displayName: users.displayName },
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .orderBy(desc(posts.publishedAt), desc(posts.createdAt))
        .limit(10),
    ]);

    return ok({
      stats: {
        totalUsers,
        newUsersToday,
        totalPosts,
        pendingPosts,
        totalComments,
        openReports,
      },
      recentUsers,
      recentPosts,
    });
  });
}
