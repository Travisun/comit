import { z } from "zod";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { ok, withUser } from "@/lib/http";

const querySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "invalid cursor")
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

/** GET /api/notifications?cursor=&limit=15 — current user's notifications. */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { cursor, limit } = parsed.data;

    const actors = alias(users, "notify_actors");
    const conditions = [eq(notifications.userId, auth.user.id)];
    if (cursor) conditions.push(lt(notifications.createdAt, new Date(cursor)));

    const rows = await db
      .select({
        id: notifications.id,
        key: notifications.key,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorUsername: actors.username,
        actorDisplayName: actors.displayName,
        actorAvatarPath: actors.avatarPath,
      })
      .from(notifications)
      .leftJoin(actors, eq(actors.id, notifications.actorId))
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const [{ n: unread }] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));

    return ok({
      items: page.map((r) => ({
        id: r.id,
        key: r.key,
        title: r.title,
        body: r.body,
        url: r.url,
        readAt: r.readAt,
        createdAt: r.createdAt,
        actor: r.actorUsername
          ? {
              username: r.actorUsername,
              displayName: r.actorDisplayName,
              avatarPath: r.actorAvatarPath,
            }
          : null,
      })),
      nextCursor:
        hasMore && page.length > 0 ? page[page.length - 1].createdAt.toISOString() : null,
      unread,
    });
  });
}
