import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { follows } from "@/db/schema";
import { AppError, conflict } from "@/core/errors";
import { emit } from "@/core/events";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { assertNotBlocked, getUserByUsername } from "@/lib/users";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
});

const querySchema = z.object({
  username: z.string().min(1).max(64),
});

/** GET /api/follows?username= — viewer's follow state for the target. */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = querySchema.safeParse({
      username: new URL(req.url).searchParams.get("username") ?? "",
    });
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");

    const target = await getUserByUsername(parsed.data.username);
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

    // 桶 action.social：per-user 默认 60 次/60s，覆盖 toggle 高频场景
    await rateLimitBucket("action.social", auth.user.id);
    const target = await getUserByUsername(parsed.data.username);
    if (target.id === auth.user.id) {
      throw conflict("不能关注自己 / You cannot follow yourself");
    }
    // 拉黑双向都要挡：blocks 表是「谁拉黑谁」的唯一真相，评论/私信侧均已调用
    // assertNotBlocked，唯独关注写入路径漏了 —— 被 A 拉黑的 B 仍能建立 follow
    // 关系，从而通过 visibility='followers' 的读取闸口看到 A 的仅关注者可见内容，
    // 并持续触发「开始关注你」通知（拉黑形同失效）。
    await assertNotBlocked(target.id, auth.user.id);

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
