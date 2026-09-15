import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { follows } from "@/db/schema";
import { AppError, conflict } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { getUserByUsername } from "@/lib/users";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
});

/** GET /api/follows?username= — viewer's follow state for the target. */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const username = new URL(req.url).searchParams.get("username") ?? "";
    const target = await getUserByUsername(username);
    if (target.id === auth.user.id) return ok({ following: false, self: true });
    const [row] = await db
      .select({ x: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, auth.user.id), eq(follows.followeeId, target.id)))
      .limit(1);
    return ok({ following: Boolean(row), self: false });
  });
}

/** POST /api/follows — toggle following a user by username. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    const target = await getUserByUsername(parsed.data.username);
    if (target.id === auth.user.id) {
      throw conflict("不能关注自己 / You cannot follow yourself");
    }

    const removed = await db
      .delete(follows)
      .where(and(eq(follows.followerId, auth.user.id), eq(follows.followeeId, target.id)))
      .returning({ followeeId: follows.followeeId });

    if (removed.length > 0) {
      void emit("user:unfollowed", {
        followerId: auth.user.id,
        followeeId: target.id,
      });
      return ok({ following: false });
    }

    await db
      .insert(follows)
      .values({ followerId: auth.user.id, followeeId: target.id })
      .onConflictDoNothing();

    void emit("user:followed", {
      followerId: auth.user.id,
      followeeId: target.id,
    });
    return ok({ following: true });
  });
}
