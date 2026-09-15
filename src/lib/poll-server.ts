import "server-only";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { pollVotes, polls } from "@/db/schema";
import type { PollView } from "@/lib/poll";

/**
 * 投票视图加载 — 供 poll API、服务端渲染（详情页）与 poll.end 通知任务复用。
 */

export async function getPollView(
  postId: string,
  viewerId?: string | null,
): Promise<PollView | null> {
  const [poll] = await db.select().from(polls).where(eq(polls.postId, postId)).limit(1);
  if (!poll) return null;

  const [tallyRows, [voterRow], myRows] = await Promise.all([
    db
      .select({ optionIndex: pollVotes.optionIndex, n: count() })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, poll.id))
      .groupBy(pollVotes.optionIndex),
    db
      .select({ n: sql<number>`count(distinct ${pollVotes.userId})`.mapWith(Number) })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, poll.id)),
    viewerId
      ? db
          .select({ optionIndex: pollVotes.optionIndex })
          .from(pollVotes)
          .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.userId, viewerId)))
      : Promise.resolve([] as { optionIndex: number }[]),
  ]);

  const tallies = poll.options.map(() => 0);
  for (const r of tallyRows) {
    if (r.optionIndex >= 0 && r.optionIndex < tallies.length) tallies[r.optionIndex] = r.n;
  }

  return {
    id: poll.id,
    postId,
    mode: poll.mode as PollView["mode"],
    options: poll.options,
    endsAt: poll.endsAt.toISOString(),
    ended: poll.endsAt.getTime() <= Date.now(),
    tallies,
    voters: voterRow?.n ?? 0,
    myVotes: myRows.map((r) => r.optionIndex).sort((a, b) => a - b),
  };
}

/** 批量加载多个帖子的投票，返回 postId → PollView。 */
export async function getPollViews(
  postIds: string[],
  viewerId?: string | null,
): Promise<Map<string, PollView>> {
  const map = new Map<string, PollView>();
  if (postIds.length === 0) return map;
  const rows = await db
    .select({ id: polls.id, postId: polls.postId })
    .from(polls)
    .where(inArray(polls.postId, postIds));
  await Promise.all(
    rows.map(async (r) => {
      const view = await getPollView(r.postId, viewerId);
      if (view) map.set(r.postId, view);
    }),
  );
  return map;
}
