import { z } from "zod";

/** 本地未读计数模型（/api/unread 响应）。 */
export const unreadSchema = z.object({
  latest: z.number(),
  following: z.number(),
  messages: z.number(),
});
export type UnreadCounts = z.infer<typeof unreadSchema>;
