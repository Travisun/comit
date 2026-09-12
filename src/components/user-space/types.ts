/**
 * Client-safe DTO types shared between server queries and client components.
 * Dates are serialized to ISO strings before crossing the RSC boundary.
 */

export interface UserBrief {
  username: string;
  displayName: string;
  avatarPath: string | null;
}

export interface PostBrief {
  id: string;
  type: "article" | "short";
  slug: string | null;
  title: string | null;
  summary: string;
  /** raw markdown for short posts ("" for articles — too large to ship) */
  content: string;
  coverPath: string | null;
  visibility: "public" | "followers";
  views: number;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  publishedAt: string | null;
  /** content annotation (AI/转载/赞助…) — optional so older payloads stay valid */
  label?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
}

export interface FeedItemDTO {
  post: PostBrief;
  author: UserBrief;
}

export interface TopicRef {
  slug: string;
  name: string;
  description?: string;
  /** number of published public posts using this topic */
  postCount?: number;
}

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
  posts: { title: string | null; slug: string | null; publishedAt: string }[];
}

export interface CollectionCardData {
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
