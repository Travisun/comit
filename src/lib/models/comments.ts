import { z } from "zod";

/** 评论模型（/api/comments 响应） */

export const commentItemSchema = z.object({
  id: z.string(),
  body: z.string(),
  /** visible | pending_review | rejected —— 审核态仅作者自见 */
  status: z.enum(["visible", "pending_review", "rejected", "hidden", "deleted"]).optional(),
  /** public | private —— 作者可见性控制（private 仅自己可见） */
  visibility: z.enum(["public", "private"]).optional(),
  createdAt: z.string(),
  likeCount: z.number(),
  liked: z.boolean().optional(),
  mine: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  user: z.object({
    username: z.string(),
    displayName: z.string(),
    avatarPath: z.string().nullable(),
  }),
  replyToCommentId: z.string().nullable(),
  replyToUsername: z.string().nullable(),
  /** 博主置顶（Discourse floats-to-top） */
  pinned: z.boolean().optional(),
  /** 博主标记的解决方案（可多个，绿勾徽标） */
  solution: z.boolean().optional(),
  /** 帖子作者管理权（置顶/解决方案菜单的显隐依据） */
  canManage: z.boolean().optional(),
});
export type CommentItem = z.infer<typeof commentItemSchema>;

/** cursor 分页页（items + nextCursor + 首页附带 viewerId） */
export const commentsPageSchema = z.object({
  items: z.array(commentItemSchema),
  nextCursor: z.string().nullable(),
  viewerId: z.string().nullable(),
});
export type CommentsPage = z.infer<typeof commentsPageSchema>;
