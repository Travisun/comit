import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { follows, users } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/messages/allowed — users the viewer can DM: mutual follows with
 * DMs enabled and an active account. Powers the "新私信" people picker. */
export async function GET(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const me = auth.user.id;

    const [followingRows, followerRows] = await Promise.all([
      db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, me)),
      db.select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, me)),
    ]);
    const followerSet = new Set(followerRows.map((r) => r.id));
    const mutualIds = [...new Set(followingRows.map((r) => r.id))].filter(
      (id) => followerSet.has(id) && id !== me,
    );

    if (mutualIds.length === 0) return ok({ items: [] });

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
      })
      .from(users)
      .where(
        and(
          inArray(users.id, mutualIds),
          eq(users.status, "active"),
          eq(users.dmEnabled, true),
        ),
      );
    return ok({ items: rows });
  });
}
