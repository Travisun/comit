import { z } from "zod";

/**
 * feed 域模型 — DTO 的单一事实来源（single source of truth）。
 *
 * 类型一律 `z.infer` 推导而不是手写 interface：schema 即文档即校验器。
 * 跨 HTTP 边界（/api/** ↔ 客户端）的数据在查询层用 schema.parse 运行时
 * 校验——服务端字段漂移在边界即报错，而不是渲染时才崩。
 *
 * 仅经 RSC props 传递（类型安全、无运行时边界）的形状留在
 * `src/components/user-space/types.ts`，不在此定义。
 */

export const wornBadgeSchema = z.object({
  name: z.string(),
  text: z.string(),
  icon: z.string(),
  style: z.string(),
});
export type WornBadge = z.infer<typeof wornBadgeSchema>;

export const userBriefSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
  /** 佩戴中的徽章（先发后审不影响；仅作者本人佩戴的 ≤3 枚） */
  badges: z.array(wornBadgeSchema).optional(),
});
export type UserBrief = z.infer<typeof userBriefSchema>;

export const postBriefSchema = z.object({
  id: z.string(),
  /** 对外短 ID（permalink /post/{publicId}，Twitter 式数字串，见 lib/public-id.ts） */
  publicId: z.string(),
  type: z.enum(["article", "short"]),
  title: z.string().nullable(),
  summary: z.string(),
  /** raw markdown for short posts ("" for articles — too large to ship) */
  content: z.string(),
  coverPath: z.string().nullable(),
  visibility: z.enum(["public", "followers", "private"]),
  /** 先发后审：作者视角下待审/未通过内容会出现在自己信息流并携带状态标签 */
  status: z.enum(["draft", "pending_review", "published", "rejected", "deleted"]).optional(),
  views: z.number(),
  likeCount: z.number(),
  commentCount: z.number(),
  repostCount: z.number(),
  publishedAt: z.string().nullable(),
  /** content annotation (AI/转载/赞助…) — optional so older payloads stay valid */
  label: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  sourceName: z.string().nullish(),
  /** 非空 ⇒ 该动态附带投票（插件槽位据此挂载 PollCard） */
  hasPoll: z.boolean().optional(),
  /** viewer 收藏态（登录态的 feed 下发；游客恒 false）——行内收藏按钮初始状态 */
  bookmarked: z.boolean().optional(),
});
export type PostBrief = z.infer<typeof postBriefSchema>;

export const feedItemSchema = z.object({
  post: postBriefSchema,
  author: userBriefSchema,
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const topicRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  postCount: z.number().optional(),
});
export type TopicRef = z.infer<typeof topicRefSchema>;

/** offset 分页信封 — 所有时间线类接口的统一形状（/api/feed …） */
export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextOffset: z.number().nullable() });
export type Paginated<T> = { items: T[]; nextOffset: number | null };

/** feed 页（已应用 item schema 的分页响应） */
export const feedPageSchema = paginatedSchema(feedItemSchema);
export type FeedPage = z.infer<typeof feedPageSchema>;
