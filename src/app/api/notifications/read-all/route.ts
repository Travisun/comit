import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

/** POST /api/notifications/read-all — mark all notifications as read. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)),
      );
    return ok();
  });
}
