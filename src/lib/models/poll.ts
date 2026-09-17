import { z } from "zod";

/** 投票视图模型（/api/posts/[id]/poll 响应）。规则常量与校验在 src/lib/poll.ts。 */

export const pollViewSchema = z.object({
  id: z.string(),
  postId: z.string(),
  mode: z.enum(["single", "multiple", "pk"]),
  options: z.array(z.string()),
  endsAt: z.string(),
  ended: z.boolean(),
  /** 每个选项的票数（与 options 下标对齐） */
  tallies: z.array(z.number()),
  /** 去重参与人数 */
  voters: z.number(),
  /** 当前用户选中的选项下标（未登录/未投为空） */
  myVotes: z.array(z.number()),
});
export type PollView = z.infer<typeof pollViewSchema>;
