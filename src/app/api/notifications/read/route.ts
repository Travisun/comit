import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";

const bodySchema = z.object({ id: z.uuid() });

/** POST /api/notifications/read — mark a single notification as read. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, parsed.data.id), eq(notifications.userId, auth.user.id)),
      );
    return ok();
  });
}
