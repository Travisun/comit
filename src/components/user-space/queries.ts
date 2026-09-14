import "server-only";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  blocks,
  collections,
  follows,
  likes,
  postTopics,
  posts,
  reposts,
  topics,
  users,
  type Post,
  type User,
} from "@/db/schema";
import type {
  ArchiveGroup,
  AuthorCardData,
  CollectionCardData,
  FeedItemDTO,
  TopicRef,
  UserBrief,
  UserStats,
  ViewerFollowState,
  ViewerInteractions,
} from "./types";

/** re-exported for view components */
export type { ViewerInteractions };

/**
 * Public-page data layer. Every list query joins `users` so cards always have
 * author info. Pagination returns `nextOffset` (null when exhausted).
 */

export type FeedItem = { post: Post; author: UserBrief };

const DAY = 86_400_000;

/* ------------------------------ serializers ------------------------------ */

export function toUserBrief(u: {
  username: string;
  displayName: string;
  avatarPath: string | null;
}): UserBrief {
  return { username: u.username, displayName: u.displayName, avatarPath: u.avatarPath };
}

export function toFeedItemDTO(item: FeedItem): FeedItemDTO {
  return {
    post: {
      id: item.post.id,
      type: item.post.type,
      slug: item.post.slug,
      title: item.post.title,
      summary: item.post.summary,
      content: item.post.type === "short" ? item.post.content : "",
      coverPath: item.post.coverPath,
      visibility: item.post.visibility,
      views: item.post.views,
      likeCount: item.post.likeCount,
      commentCount: item.post.commentCount,
      repostCount: item.post.repostCount,
      publishedAt: item.post.publishedAt ? item.post.publishedAt.toISOString() : null,
      label: item.post.label,
      sourceUrl: item.post.sourceUrl,
      sourceName: item.post.sourceName,
    },
    author: item.author,
  };
}

/* --------------------------- published post lists ------------------------ */

export interface PublishedPostsQuery {
  authorId?: string;
  topicSlug?: string;
  collectionId?: string;
  /** keep only articles */
  excludeShort?: boolean;
  /** explicit type filter (wins over excludeShort) */
  type?: "article" | "short";
  limit?: number;
  offset?: number;
}

/** Published + public posts, newest first, with author info. */
export async function getPublishedPosts(
  opts: PublishedPostsQuery = {},
): Promise<{ items: FeedItem[]; nextOffset: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const type = opts.type ?? (opts.excludeShort ? "article" : undefined);

  const conds = [eq(posts.status, "published"), eq(posts.visibility, "public")];
  if (opts.authorId) conds.push(eq(posts.authorId, opts.authorId));
  if (opts.collectionId) conds.push(eq(posts.collectionId, opts.collectionId));
  if (type) conds.push(eq(posts.type, type));
  if (opts.topicSlug) {
    conds.push(
      inArray(
        posts.id,
        db
          .select({ id: postTopics.postId })
          .from(postTopics)
          .innerJoin(topics, eq(topics.id, postTopics.topicId))
          .where(eq(topics.slug, opts.topicSlug)),
      ),
    );
  }

  const rows = await db
    .select({
      post: posts,
      author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(...conds))
    .orderBy(desc(posts.publishedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextOffset: hasMore ? offset + limit : null };
}

/** Hot posts of the last 30 days by views + 3×likes (falls back to all-time). */
export async function getHotPosts(limit = 5): Promise<FeedItem[]> {
  const score = sql`(${posts.views} + ${posts.likeCount} * 3)`;
  const base = [eq(posts.status, "published"), eq(posts.visibility, "public"), eq(posts.type, "article")];
  const baseQuery = (extra: ReturnType<typeof and> | undefined) =>
    db
      .select({
        post: posts,
        author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(extra)
      .orderBy(desc(score))
      .limit(limit);

  const recent = await baseQuery(and(...base, gte(posts.publishedAt, new Date(Date.now() - 30 * DAY))));
  if (recent.length >= limit) return recent;
  return baseQuery(and(...base));
}

/** Hot posts of one author (for the sidebar "hot-posts" widget). */
export async function getUserHotPosts(userId: string, limit = 5): Promise<FeedItem[]> {
  return db
    .select({
      post: posts,
      author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(posts.authorId, userId), eq(posts.status, "published"), eq(posts.visibility, "public")))
    .orderBy(desc(sql`(${posts.views} + ${posts.likeCount} * 3)`))
    .limit(limit);
}

/* -------------------------------- topics --------------------------------- */

export interface TopicWithCount extends TopicRef {
  id: string;
  postCount: number;
}

/** Topics ranked by published public articles in the last 30 days. */
export async function getTrendingTopics(limit = 20): Promise<TopicWithCount[]> {
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      name: topics.name,
      description: topics.description,
      n: count(postTopics.postId),
    })
    .from(topics)
    .innerJoin(postTopics, eq(postTopics.topicId, topics.id))
    .innerJoin(
      posts,
      and(
        eq(posts.id, postTopics.postId),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        gte(posts.publishedAt, new Date(Date.now() - 30 * DAY)),
      ),
    )
    .groupBy(topics.id)
    .orderBy(desc(count(postTopics.postId)))
    .limit(limit);
  return rows.map((r) => ({ ...r, postCount: Number(r.n) }));
}

export async function getTopicBySlug(slug: string): Promise<(TopicWithCount & { description: string }) | null> {
  const [topic] = await db.select().from(topics).where(eq(topics.slug, slug)).limit(1);
  if (!topic) return null;
  const [{ n }] = await db
    .select({ n: count(posts.id) })
    .from(posts)
    .innerJoin(postTopics, eq(postTopics.postId, posts.id))
    .where(
      and(
        eq(postTopics.topicId, topic.id),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
      ),
    );
  return { id: topic.id, slug: topic.slug, name: topic.name, description: topic.description, postCount: Number(n) };
}

export async function getPostTopics(postId: string): Promise<TopicRef[]> {
  return db
    .select({ slug: topics.slug, name: topics.name })
    .from(postTopics)
    .innerJoin(topics, eq(topics.id, postTopics.topicId))
    .where(eq(postTopics.postId, postId))
    .orderBy(topics.name);
}

/* -------------------------------- authors -------------------------------- */

/** Most publishing active users with follower counts. */
export async function getActiveAuthors(limit = 5): Promise<AuthorCardData[]> {
  const rows = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      avatarPath: users.avatarPath,
      bio: users.bio,
      postCount: count(posts.id),
      followerCount: sql<number>`(select count(*) from ${follows} where ${follows.followeeId} = ${users.id})`,
    })
    .from(users)
    .innerJoin(
      posts,
      and(
        eq(posts.authorId, users.id),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
      ),
    )
    .where(eq(users.status, "active"))
    .groupBy(users.id)
    .orderBy(desc(count(posts.id)))
    .limit(limit);
  return rows.map((r) => ({ ...r, postCount: Number(r.postCount), followerCount: Number(r.followerCount) }));
}

/* --------------------------------- users --------------------------------- */

export async function getActiveUserByUsername(username: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, "active")))
    .limit(1);
  return user ?? null;
}

export async function getActiveUserBySubdomain(subdomain: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.subdomain, subdomain), eq(users.status, "active")))
    .limit(1);
  return user ?? null;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const [[p], [f], [g], [l]] = await Promise.all([
    db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.authorId, userId), eq(posts.status, "published"))),
    db.select({ n: count() }).from(follows).where(eq(follows.followeeId, userId)),
    db.select({ n: count() }).from(follows).where(eq(follows.followerId, userId)),
    db
      .select({ n: sql<number>`coalesce(sum(${posts.likeCount}), 0)` })
      .from(posts)
      .where(and(eq(posts.authorId, userId), eq(posts.status, "published"))),
  ]);
  return {
    posts: Number(p.n),
    followers: Number(f.n),
    following: Number(g.n),
    likesReceived: Number(l.n),
  };
}

/** Follow/block edges between viewer and target (all false when anonymous). */
export async function getFollowState(viewerId: string | null | undefined, targetId: string): Promise<ViewerFollowState> {
  if (!viewerId || viewerId === targetId) {
    return { following: false, followedBy: false, blocking: false, blockedBy: false };
  }
  const [f, fb, b, bb] = await Promise.all([
    db
      .select({ x: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)))
      .limit(1),
    db
      .select({ x: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId)))
      .limit(1),
    db
      .select({ x: blocks.blockerId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, targetId)))
      .limit(1),
    db
      .select({ x: blocks.blockerId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, viewerId)))
      .limit(1),
  ]);
  return {
    following: f.length > 0,
    followedBy: fb.length > 0,
    blocking: b.length > 0,
    blockedBy: bb.length > 0,
  };
}

/** Monthly archive groups (published public posts), newest first. */
export async function getArchives(userId: string): Promise<ArchiveGroup[]> {
  const rows = await db
    .select({ title: posts.title, slug: posts.slug, publishedAt: posts.publishedAt })
    .from(posts)
    .where(
      and(
        eq(posts.authorId, userId),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(500);

  const groups = new Map<string, ArchiveGroup>();
  for (const r of rows) {
    if (!r.publishedAt) continue;
    const d = r.publishedAt;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    let g = groups.get(key);
    if (!g) {
      g = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, count: 0, posts: [] };
      groups.set(key, g);
    }
    g.count += 1;
    g.posts.push({ title: r.title, slug: r.slug, publishedAt: d.toISOString() });
  }
  return [...groups.values()];
}

/** Topics an author uses most (for the sidebar topic cloud). */
export async function getUserTopicCloud(userId: string, limit = 14): Promise<TopicWithCount[]> {
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      name: topics.name,
      n: count(postTopics.postId),
    })
    .from(postTopics)
    .innerJoin(topics, eq(topics.id, postTopics.topicId))
    .innerJoin(
      posts,
      and(
        eq(posts.id, postTopics.postId),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
      ),
    )
    .where(eq(posts.authorId, userId))
    .groupBy(topics.id)
    .orderBy(desc(count(postTopics.postId)))
    .limit(limit);
  return rows.map((r) => ({ ...r, postCount: Number(r.n) }));
}

/* ------------------------------ collections ------------------------------ */

export async function getUserCollections(userId: string): Promise<CollectionCardData[]> {
  const rows = await db
    .select({
      slug: collections.slug,
      name: collections.name,
      description: collections.description,
      postCount: sql<number>`(select count(*) from ${posts} where ${posts.collectionId} = ${collections.id} and ${posts.status} = 'published')`,
    })
    .from(collections)
    .where(eq(collections.userId, userId))
    .orderBy(collections.sortOrder, desc(collections.createdAt));
  return rows.map((r) => ({ ...r, postCount: Number(r.postCount) }));
}

export async function getCollectionBySlug(
  userId: string,
  slug: string,
): Promise<CollectionCardData | null> {
  const [c] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.slug, slug)))
    .limit(1);
  if (!c) return null;
  const [{ n }] = await db
    .select({ n: count() })
    .from(posts)
    .where(and(eq(posts.collectionId, c.id), eq(posts.status, "published")));
  return { slug: c.slug, name: c.name, description: c.description, postCount: Number(n) };
}

export async function getCollectionIdBySlug(userId: string, slug: string): Promise<string | null> {
  const [c] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.slug, slug)))
    .limit(1);
  return c?.id ?? null;
}

/* ------------------------------ post detail ------------------------------ */

export async function getViewerInteractions(
  postId: string,
  viewerId: string | null | undefined,
): Promise<ViewerInteractions> {
  if (!viewerId) return { liked: false, reposted: false };
  const [l, r] = await Promise.all([
    db
      .select({ x: likes.userId })
      .from(likes)
      .where(and(eq(likes.userId, viewerId), eq(likes.targetType, "post"), eq(likes.targetId, postId)))
      .limit(1),
    db
      .select({ x: reposts.userId })
      .from(reposts)
      .where(and(eq(reposts.userId, viewerId), eq(reposts.postId, postId)))
      .limit(1),
  ]);
  return { liked: l.length > 0, reposted: r.length > 0 };
}

/** visibility gate — followers-only posts require following (or being author). */
export function postVisibleTo(
  post: Pick<Post, "visibility" | "authorId">,
  viewer: { id: string; following: boolean } | null,
): boolean {
  if (post.visibility !== "followers") return true;
  if (!viewer) return false;
  if (viewer.id === post.authorId) return true;
  return viewer.following;
}

export type PostViewData = {
  post: Post;
  author: User;
  topics: TopicRef[];
  collection: { slug: string; name: string } | null;
  followState: ViewerFollowState;
  interactions: ViewerInteractions;
  /** true ⇒ render the "follow to read" lock card instead of the body */
  gated: boolean;
};

export type PostViewResult = PostViewData | "blocked" | null;

/**
 * Load everything the article page needs. Lookup by author username (path
 * routes) or author subdomain (subdomain dispatcher). Returns:
 *  - null            → post not found / not published
 *  - "blocked"       → author has blocked the viewer (404 to the viewer)
 *  - PostViewData    → renderable (check `gated` for the locked body)
 */
export async function getPostForView(opts: {
  slug: string;
  username?: string;
  subdomain?: string;
  viewer: User | null;
}): Promise<PostViewResult> {
  const authorCond = opts.username
    ? eq(users.username, opts.username)
    : opts.subdomain
      ? eq(users.subdomain, opts.subdomain)
      : null;

  const [row] = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(
      and(
        ...(authorCond ? [authorCond] : []),
        eq(posts.slug, opts.slug),
        // the author can preview their own post in any lifecycle state
        // (draft / pending review / recycle bin); everyone else sees published
        opts.viewer
          ? or(eq(posts.status, "published"), eq(posts.authorId, opts.viewer.id))
          : eq(posts.status, "published"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { post, author } = row;
  const isSelf = Boolean(opts.viewer && opts.viewer.id === author.id);
  const followState = isSelf
    ? { following: false, followedBy: false, blocking: false, blockedBy: false }
    : await getFollowState(opts.viewer?.id ?? null, author.id);
  if (followState.blockedBy) return "blocked";

  const viewerForGate = opts.viewer
    ? { id: opts.viewer.id, following: followState.following }
    : null;
  const gated = !postVisibleTo(post, viewerForGate);

  const [topics_, interactions, collectionRow] = await Promise.all([
    getPostTopics(post.id),
    getViewerInteractions(post.id, opts.viewer?.id),
    post.collectionId
      ? db
          .select({ slug: collections.slug, name: collections.name })
          .from(collections)
          .where(eq(collections.id, post.collectionId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    post,
    author,
    topics: topics_,
    collection: collectionRow[0] ?? null,
    followState,
    interactions,
    gated,
  };
}

/** Fire-and-forget view counter (never blocks rendering). */
export function incrementPostViews(postId: string): void {
  void db
    .update(posts)
    .set({ views: sql`${posts.views} + 1` })
    .where(eq(posts.id, postId))
    .catch(() => undefined);
}

/* --------------------------- RSS / sitemap data --------------------------- */

export interface RssPost {
  title: string;
  slug: string;
  summary: string;
  coverPath: string | null;
  publishedAt: Date;
  authorUsername: string;
  authorName: string;
}

function rssSelection() {
  return {
    title: posts.title,
    slug: posts.slug,
    summary: posts.summary,
    coverPath: posts.coverPath,
    publishedAt: posts.publishedAt,
    authorUsername: users.username,
    authorName: users.displayName,
  };
}

const rssConds = [eq(posts.status, "published"), eq(posts.visibility, "public"), eq(posts.type, "article")];

function toRssPosts(
  rows: {
    title: string | null;
    slug: string | null;
    summary: string;
    coverPath: string | null;
    publishedAt: Date | null;
    authorUsername: string;
    authorName: string;
  }[],
): RssPost[] {
  return rows.flatMap((r) =>
    r.title && r.slug && r.publishedAt
      ? [{ ...r, title: r.title, slug: r.slug, publishedAt: r.publishedAt }]
      : [],
  );
}

export async function getSiteRssPosts(limit = 40): Promise<RssPost[]> {
  const rows = await db
    .select(rssSelection())
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(...rssConds, eq(users.status, "active")))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
  return toRssPosts(rows);
}

export async function getUserRssPosts(userId: string, limit = 40): Promise<RssPost[]> {
  const rows = await db
    .select(rssSelection())
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(...rssConds, eq(posts.authorId, userId)))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
  return toRssPosts(rows);
}

/* ===================== community & brand-home queries ==================== */

export interface CommunityStats {
  members: number;
  posts: number;
  today: number;
}

/** Platform-level counters for the community home banner. */
export async function getCommunityStats(): Promise<CommunityStats> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [[u], [p], [t]] = await Promise.all([
    db.select({ n: count() }).from(users).where(eq(users.status, "active")),
    db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.status, "published"), eq(posts.visibility, "public"))),
    db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.status, "published"), gte(posts.publishedAt, startOfToday))),
  ]);
  return { members: u.n, posts: p.n, today: t.n };
}

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  bio: string;
  verified: { type: string; label: string; approvedAt: string } | null;
}

const userCardSelection = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarPath: users.avatarPath,
  bio: users.bio,
  verified: users.verified,
};

/** People who follow the given user (粉丝). */
export async function listFollowers(userId: string, limit = 100): Promise<UserCard[]> {
  const rows = await db
    .select(userCardSelection)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followeeId, userId), eq(users.status, "active")))
    .orderBy(desc(follows.createdAt))
    .limit(limit);
  return rows as UserCard[];
}

/** People the given user follows (关注中). */
export async function listFollowing(userId: string, limit = 100): Promise<UserCard[]> {
  const rows = await db
    .select(userCardSelection)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followeeId))
    .where(and(eq(follows.followerId, userId), eq(users.status, "active")))
    .orderBy(desc(follows.createdAt))
    .limit(limit);
  return rows as UserCard[];
}

/** Author's best-performing articles — the brand "代表作" strip. */
/** Published + public posts matching a free-text query (explore search). */
export async function searchPublishedPosts(q: string, limit = 20): Promise<FeedItem[]> {
  const needle = q.trim().slice(0, 80);
  if (!needle) return [];
  const like = `%${needle}%`;
  return db
    .select({
      post: posts,
      author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(
      and(
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        or(ilike(posts.title, like), ilike(posts.summary, like), ilike(posts.content, like)),
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
}

export async function getTopPosts(
  userId: string,
  limit = 2,
): Promise<{ post: Post; author: { username: string; displayName: string; avatarPath: string | null } }[]> {
  const rows = await db
    .select({ post: posts, author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath } })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(
      and(
        eq(posts.authorId, userId),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        eq(posts.type, "article"),
      ),
    )
    .orderBy(desc(sql`(${posts.likeCount} * 3 + ${posts.views})`))
    .limit(limit);
  return rows as never;
}
