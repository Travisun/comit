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

/**
 * 投票视图对谁可见 —— 与 /api/posts/[id] 的帖子可见性同口径。
 *
 * WHY：getPollView 会带出选项文本、票数和参与人数，这些是帖子内容的一部分。
 * 草稿 / 待审 / 回收站 / 私有帖子虽然没有公开页面，但 poll 端点原先只按 postId
 * 查投票，任何人凭 id 就能读到作者尚未公开的内容（信息泄露）。
 */
async function visiblePollPost(postId: string, viewerId: string | null) {
  const [row] = await db
    .select({
      authorId: posts.authorId,
      status: posts.status,
      visibility: posts.visibility,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row) return null;
  if (viewerId && row.authorId === viewerId) return row;
  if (row.status !== "published" || row.visibility === "private") return null;
  if (row.visibility === "followers") {
    if (!viewerId) return null;
    const [f] = await db
      .select({ followerId: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, row.authorId)))
      .limit(1);
    if (!f) return null;
  }
  return row;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return withApi(req, async () => {
    const { id } = await ctx.params;
    const viewer = await apiUser();
    if (!(await visiblePollPost(id, viewer?.user.id ?? null)))
      throw notFound("投票不存在 / Poll not found");
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
    // 私有帖仅作者可见：非作者凭 postId 也拿不到 poll，但投票写入仍要挡住
    if (post.visibility === "private" && post.authorId !== auth.user.id) {
      throw notFound("投票不存在 / Poll not found");
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
      // 先锁投票行：唯一索引是 (pollId,userId,optionIndex)，两个并发的单选投票
      // （各选不同项）互相看不到对方的行，会同时提交 ⇒ 同一人在 single/pk 上
      // 留下两票。锁住 poll 行把整场改票串行化（同 verification.server 的写法）。
      await tx
        .select({ id: polls.id })
        .from(polls)
        .where(eq(polls.id, poll.id))
        .limit(1)
        .for("update");
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
