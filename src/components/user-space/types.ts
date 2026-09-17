/**
 * Client-safe DTO types shared between server queries and client components.
 * Dates are serialized to ISO strings before crossing the RSC boundary.
 *
 * 跨 HTTP 边界的核心模型（UserBrief / PostBrief / FeedItemDTO / TopicRef）
 * 由 Zod schema 推导（src/lib/models/feed.ts）——schema 即类型即校验器，
 * 这里保留再导出以兼容既有引用。仅经 RSC props 传递（编译期即可校验、
 * 无运行时边界）的形状继续定义在本文件。
 */

import type { FeedItem, UserBrief } from "@/lib/models/feed";

export type { UserBrief, PostBrief, TopicRef } from "@/lib/models/feed";

/** feed 行（post + author）；历史名称为 FeedItemDTO */
export type FeedItemDTO = FeedItem;

export interface AuthorCardData extends UserBrief {
  bio?: string;
  postCount: number;
  followerCount: number;
}

export interface UserStats {
  posts: number;
  followers: number;
  following: number;
  likesReceived: number;
}

export interface ArchiveGroup {
  year: number;
  month: number;
  count: number;
  posts: { id: string; title: string | null; slug: string | null; publishedAt: string }[];
}

export interface CollectionCardData {
  id: string;
  slug: string;
  name: string;
  description: string;
  postCount: number;
}

export interface ViewerFollowState {
  following: boolean;
  followedBy: boolean;
  /** viewer has blocked the target */
  blocking: boolean;
  /** target has blocked the viewer */
  blockedBy: boolean;
}

/** viewer's like/repost state on a post */
export interface ViewerInteractions {
  liked: boolean;
  reposted: boolean;
}
