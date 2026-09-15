import { z } from "zod";

/** 评论模型（/api/comments 响应） */

export const commentItemSchema = z.object({
  id: z.string(),
  body: z.string(),
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
});
export type CommentItem = z.infer<typeof commentItemSchema>;

/** cursor 分页页（items + nextCursor + 首页附带 viewerId） */
export const commentsPageSchema = z.object({
  items: z.array(commentItemSchema),
  nextCursor: z.string().nullable(),
  viewerId: z.string().nullable(),
});
export type CommentsPage = z.infer<typeof commentsPageSchema>;
