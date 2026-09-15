import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pollVotes, polls, posts } from "@/db/schema";
import { routes } from "@/core/routes";
import { notifySend } from "./notifications";

/**
 * 投票结束通知（poll.end 延迟任务）：
 * 到期后给投票作者与所有参与投票的用户发送结果汇总，
 * 点击通知跳转到投票帖子。未发布/已删除的帖子直接跳过。
 */
export async function processPollEnd(postId: string): Promise<void> {
  const [row] = await db
    .select({ poll: polls, post: posts })
    .from(polls)
    .innerJoin(posts, eq(posts.id, polls.postId))
    .where(eq(polls.postId, postId))
    .limit(1);
  if (!row) return; // 帖子（连带投票）已被删除
  const { poll, post } = row;
  if (poll.notifiedAt) return; // 幂等：只通知一次

  if (post.status !== "published") {
    // 未走完审核流程的投票不发打扰；标记避免反复重试
    await db.update(polls).set({ notifiedAt: new Date() }).where(eq(polls.id, poll.id));
    return;
  }

  const tallies = await tallyOf(poll.id, poll.options.length);
  const total = tallies.reduce<number>((a, b) => a + b, 0);

  // 参与用户（去重）+ 作者
  const voterRows = await db
    .selectDistinct({ userId: pollVotes.userId })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, poll.id));
  const recipients = [...new Set([...voterRows.map((v) => v.userId), post.authorId])];

  const url = post.slug ? routes.article(post.slug) : routes.shortPost(post.id);
  const title = { zh: "投票已结束 · 结果出炉", en: "Poll ended — results are in" };
  const lead = leadLine(poll.options, tallies);

  for (const userId of recipients) {
    const summary = `${
      userId === post.authorId ? "你的投票" : "你参与的投票"
    }共 ${total} 人参与，${lead}`;
    await notifySend(userId, {
      key: "poll.ended",
      title,
      body: { zh: summary, en: summary },
      url,
      payload: { postId: post.id, pollId: poll.id, total },
    });
  }

  await db.update(polls).set({ notifiedAt: new Date() }).where(eq(polls.id, poll.id));
}

/* ------------------------------- helpers --------------------------------- */

async function tallyOf(pollId: string, optionCount: number): Promise<number[]> {
  const rows = await db
    .select({ optionIndex: pollVotes.optionIndex })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId));
  const tallies = Array.from({ length: optionCount }, () => 0);
  for (const r of rows) {
    if (r.optionIndex >= 0 && r.optionIndex < optionCount) tallies[r.optionIndex] += 1;
  }
  return tallies;
}

/** 领先选项摘要：「“选项A” 以 40% 领先」或平票时「票数接近」。 */
function leadLine(options: string[], tallies: number[]): string {
  const total = tallies.reduce((a, b) => a + b, 0);
  if (total === 0) return "暂无人参与。";
  const max = Math.max(...tallies);
  const leaders = tallies.map((c, i) => ({ c, i })).filter((x) => x.c === max);
  const pct = Math.round((max / total) * 100);
  if (leaders.length === 1 && max !== total) {
    return `“${options[leaders[0].i]}” 以 ${pct}% 领先。点击查看完整结果。`;
  }
  return "各选项票数接近，点击查看完整结果。";
}
