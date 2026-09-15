import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { blocks, follows } from "@/db/schema";
import { AppError, conflict } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { getUserByUsername } from "@/lib/users";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
});

/** GET /api/blocks?username= — whether the viewer blocks the target. */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const username = new URL(req.url).searchParams.get("username") ?? "";
    const target = await getUserByUsername(username);
    if (target.id === auth.user.id) return ok({ blocked: false, self: true });
    const [row] = await db
      .select({ x: blocks.blockerId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, auth.user.id), eq(blocks.blockedId, target.id)))
      .limit(1);
    return ok({ blocked: Boolean(row), self: false });
  });
}

/** POST /api/blocks — toggle blocking a user. Blocking unfollows both ways. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    const target = await getUserByUsername(parsed.data.username);
    if (target.id === auth.user.id) {
      throw conflict("不能拉黑自己 / You cannot block yourself");
    }
    const me = auth.user.id;
    const them = target.id;

    const removed = await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, them)))
      .returning({ blockedId: blocks.blockedId });

    let blocked: boolean;
    if (removed.length > 0) {
      blocked = false;
    } else {
      await db.insert(blocks).values({ blockerId: me, blockedId: them }).onConflictDoNothing();
      blocked = true;
    }

    if (blocked) {
      // blocking severs the follow relationship in both directions
      const removedFollows = await db
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, me), eq(follows.followeeId, them)),
            and(eq(follows.followerId, them), eq(follows.followeeId, me)),
          ),
        )
        .returning({ followerId: follows.followerId });
      for (const f of removedFollows) {
        void emit("user:unfollowed", { followerId: f.followerId, followeeId: f.followerId === me ? them : me });
      }
    }

    return ok({ blocked });
  });
}
