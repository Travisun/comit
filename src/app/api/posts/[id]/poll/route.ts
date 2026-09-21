import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { follows, pollVotes, polls, posts } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/core/errors";
import { jsonBody, ok, withApi, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { apiUser } from "@/lib/auth/guards";
import { POLL_OPTIONS_MAX } from "@/lib/poll";
import { parseWith } from "../../_shared";
import { getPollView } from "@/lib/poll-server";

/**
 * GET  /api/posts/[id]/poll — 投票 + 计票 + 当前用户的投票项（游客可见结果）。
 * POST /api/posts/[id]/poll — 投票 { optionIndexes: number[] }：
 *   单选恰好 1 项，多选 1..N 项；已结束（410）、帖子未发布、关注者可见帖
 *   未关注时拒绝。结束前可改票（整组替换，唯一索引兜底并发重复）。
 */

type Ctx = { params: Promise<{ id: string }> };

const voteSchema = z.object({
  optionIndexes: z
    .array(z.number().int().min(0).max(POLL_OPTIONS_MAX))
    .min(1)
    .max(POLL_OPTIONS_MAX),
});

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return withApi(req, async () => {
    const { id } = await ctx.params;
    const viewer = await apiUser();
    const view = await getPollView(id, viewer?.user.id ?? null);
    if (!view) throw notFound("投票不存在 / Poll not found");
    return ok(view);
  });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id: postId } = await ctx.params;
    // 改票 = 删旧插新事务，无限流则可被高频刷库；与关注/收藏共用社交桶
    await rateLimitBucket("action.social", auth.user.id);
    const body = parseWith(voteSchema, await jsonBody(req));

    const [row] = await db
      .select({ poll: polls, post: posts })
      .from(polls)
      .innerJoin(posts, eq(posts.id, polls.postId))
      .where(eq(polls.postId, postId))
      .limit(1);
    if (!row) throw notFound("投票不存在 / Poll not found");
    const { poll, post } = row;

    if (post.status !== "published") {
      throw forbidden("帖子尚未发布 / Post is not published");
    }
    // 关注者可见帖：仅作者的关注者可投
    if (post.visibility === "followers" && post.authorId !== auth.user.id) {
      const [f] = await db
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(and(eq(follows.followerId, auth.user.id), eq(follows.followeeId, post.authorId)))
        .limit(1);
      if (!f) throw forbidden("该帖子仅对关注者开放 / Followers only");
    }
    if (poll.endsAt.getTime() <= Date.now()) {
      throw new AppError("投票已结束 / Poll has ended", 410, "poll_ended");
    }
    const unique = [...new Set(body.optionIndexes)];
    if (unique.some((i) => i >= poll.options.length)) {
      throw new AppError("选项不存在 / Unknown option", 400, "validation_error");
    }
    if (poll.mode === "single" && unique.length !== 1) {
      throw new AppError("单选投票只能选择一项 / Pick exactly one option", 400, "validation_error");
    }
    // PK 为两方对战：同单选，一方一票
    if (poll.mode === "pk" && unique.length !== 1) {
      throw new AppError("PK 只能为其中一方投票 / Pick exactly one side", 400, "validation_error");
    }

    // 整组替换：改票 = 删旧插新
    await db.transaction(async (tx) => {
      await tx
        .delete(pollVotes)
        .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.userId, auth.user.id)));
      await tx
        .insert(pollVotes)
        .values(unique.map((optionIndex) => ({ pollId: poll.id, userId: auth.user.id, optionIndex })));
    });

    return ok(await getPollView(postId, auth.user.id));
  });
}
