import { z } from "zod";

/** 私信 / 收件箱模型 */

export const messageItemSchema = z.object({
  id: z.string(),
  body: z.string().nullable(),
  mediaPath: z.string().nullable(),
  mine: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageItem = z.infer<typeof messageItemSchema>;

export const messagesPageSchema = z.object({
  items: z.array(messageItemSchema),
  nextCursor: z.string().nullable(),
});
export type MessagesPage = z.infer<typeof messagesPageSchema>;

export const conversationSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
  lastMessage: z
    .object({ body: z.string(), createdAt: z.string(), mine: z.boolean() })
    .nullable(),
  unread: z.number(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  url: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  actor: z
    .object({
      username: z.string(),
      displayName: z.string(),
      avatarPath: z.string().nullable(),
    })
    .nullable(),
});
export type NotificationItem = z.infer<typeof notificationSchema>;

export const allowedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
});
export type AllowedUser = z.infer<typeof allowedUserSchema>;
