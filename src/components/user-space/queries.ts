import "server-only";
import { cache } from "react";
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
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  blocks,
  bookmarks,
  collections,
  comments,
  follows,
  likes,
  polls,
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
  CommentActivityRow,
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

export type FeedItem = { post: Post; author: UserBrief; /** 非空 ⇒ 该帖附带投票 */ pollId?: string | null };

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
      publicId: item.post.publicId,
      type: item.post.type,
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
      hasPoll: Boolean(item.pollId),
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
  /** 关注流：限定为该 viewer 关注的作者 */
  followingOf?: string;
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
  // 关注流：只看自己关注的作者（无关注则返回空流）
  if (opts.followingOf) {
    conds.push(
      inArray(
        posts.authorId,
        db
          .select({ id: follows.followeeId })
          .from(follows)
          .where(eq(follows.followerId, opts.followingOf)),
      ),
    );
  }
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
      pollId: polls.id,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
    .where(and(...conds))
    .orderBy(desc(posts.publishedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextOffset: hasMore ? offset + limit : null };
}

/* ------------------------- profile activity timeline ---------------------- */

/** 「动态」时间线元素：短帖 或 该用户发表的评论 */
export type ProfileActivityItem =
  | { kind: "short"; post: Post; author: UserBrief; pollId?: string | null }
  | { kind: "comment"; comment: CommentActivityRow };

export type { CommentActivityRow };

/**
 * 个人主页「动态」时间线：短帖 + 该用户的评论，按时间全局倒序合并分页。
 * 先用 UNION 子查询取出本页 (kind, id)，再分批取详情（复用 FeedItem 行），
 * 保证跨两种内容的全局分页正确。
 * includeOwnPending（本人视角）：附带 pending_review / rejected 的自见内容。
 */
export async function getProfileActivity(opts: {
  userId: string;
  includeOwnPending?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: ProfileActivityItem[]; nextOffset: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const selfView = Boolean(opts.includeOwnPending);
  const postStatus = selfView
    ? sql`in ('published', 'pending_review', 'rejected')`
    : sql`= 'published'`;
  const commentStatus = selfView
    ? sql`in ('visible', 'pending_review', 'rejected')`
    : sql`= 'visible'`;

  const idRes = await db.execute<{ kind: "short" | "comment"; id: string }>(sql`
    select u.kind, u.id from (
      select 'short'::text as kind, p.id as id, p.published_at as at
        from posts p
       where p.author_id = ${opts.userId}
         and p.type = 'short'
         and p.status ${postStatus}
         and p.visibility ${selfView ? sql`in ('public', 'private')` : sql`= 'public'`}
      union all
      select 'comment'::text as kind, c.id as id, c.created_at as at
        from comments c
        join posts p2 on p2.id = c.post_id
       where c.user_id = ${opts.userId}
         and c.status ${commentStatus}
         and c.visibility ${selfView ? sql`in ('public', 'private')` : sql`= 'public'`}
         and p2.status = 'published'
         and p2.visibility = 'public'
    ) u
    order by u.at desc
    limit ${limit + 1} offset ${offset}
  `);
  const idRows = idRes.rows;
  const hasMore = idRows.length > limit;
  const pageRows = hasMore ? idRows.slice(0, limit) : idRows;

  const shortIds = pageRows.filter((r) => r.kind === "short").map((r) => r.id);
  const commentIds = pageRows.filter((r) => r.kind === "comment").map((r) => r.id);

  const replyUsers = alias(users, "reply_users");
  const [shortRows, commentRows] = await Promise.all([
    shortIds.length
      ? db
          .select({
            post: posts,
            author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
            pollId: polls.id,
          })
          .from(posts)
          .innerJoin(users, eq(users.id, posts.authorId))
          .leftJoin(polls, eq(polls.postId, posts.id))
          .where(inArray(posts.id, shortIds))
      : Promise.resolve([] as { post: Post; author: UserBrief; pollId: string | null }[]),
    commentIds.length
      ? db
          .select({
            id: comments.id,
            body: comments.body,
            status: comments.status,
            visibility: comments.visibility,
            likeCount: comments.likeCount,
            createdAt: comments.createdAt,
            postPublicId: posts.publicId,
            postType: posts.type,
            postTitle: posts.title,
            postSummary: posts.summary,
            replyToUsername: replyUsers.username,
          })
          .from(comments)
          .innerJoin(posts, eq(posts.id, comments.postId))
          .leftJoin(replyUsers, eq(replyUsers.id, comments.replyToUserId))
          .where(inArray(comments.id, commentIds))
      : Promise.resolve([] as CommentActivityRow[]),
  ]);

  const shortById = new Map(shortRows.map((r) => [r.post.id, r]));
  const commentById = new Map(commentRows.map((r) => [r.id, r]));
  const items: ProfileActivityItem[] = [];
  for (const r of pageRows) {
    if (r.kind === "short") {
      const row = shortById.get(r.id);
      if (row) items.push({ kind: "short", ...row });
    } else {
      const row = commentById.get(r.id);
      if (row) items.push({ kind: "comment", comment: row });
    }
  }
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
        pollId: polls.id,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(polls, eq(polls.postId, posts.id))
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
      pollId: polls.id,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
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

/** 单用户模式：站点主页对应的作者（site.singleUser 设置）。 */
export async function resolveSingleUser(username: string): Promise<User | null> {
  return getActiveUserByUsername(username);
}

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
    .select({ publicId: posts.publicId, title: posts.title, publishedAt: posts.publishedAt })
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
    g.posts.push({ publicId: r.publicId, title: r.title, publishedAt: d.toISOString() });
  }
  return [...groups.values()];
}

/** 用户的收藏列表（新→旧），带作者信息供卡片渲染。 */
export async function listBookmarkPosts(
  userId: string,
  limit = 100,
): Promise<FeedItemDTO[]> {
  const rows = await db
    .select({
      post: posts,
      author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
      pollId: polls.id,
    })
    .from(bookmarks)
    .innerJoin(posts, eq(posts.id, bookmarks.postId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
    .where(and(eq(bookmarks.userId, userId), eq(posts.status, "published")))
    .orderBy(desc(bookmarks.createdAt))
    .limit(limit);
  // DAL 出口即 DTO：杜绝 Date/全文 db 行对象经类型注解漂移到客户端
  return rows.map(toFeedItemDTO);
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
      id: collections.id,
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

// cache()：同一请求内 generateMetadata 与页面组件共享同一次查询结果
export const getCollectionBySlug = cache(async function getCollectionBySlug(
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
  // id 一并返回：调用方（collections/[slug] 页）不再需要 getCollectionIdBySlug
  // 的第二次同条件查询
  return { id: c.id, slug: c.slug, name: c.name, description: c.description, postCount: Number(n) };
});


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

/** visibility gate — private 仅作者自见；followers-only 需关注（或为作者）。 */
export function postVisibleTo(
  post: Pick<Post, "visibility" | "authorId">,
  viewer: { id: string; following: boolean } | null,
): boolean {
  if (post.visibility === "private") {
    return Boolean(viewer && viewer.id === post.authorId);
  }
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
  publicId: string;
  viewer: User | null;
}): Promise<PostViewResult> {
  const [row] = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(
      and(
        eq(posts.publicId, opts.publicId),
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
  // private（仅自己可见）对非作者按不存在处理（404），不展示关注锁卡片
  if (post.visibility === "private" && !(viewerForGate && viewerForGate.id === post.authorId)) {
    return null;
  }
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
  publicId: string;
  summary: string;
  coverPath: string | null;
  publishedAt: Date;
  authorUsername: string;
  authorName: string;
}

function rssSelection() {
  return {
    title: posts.title,
    publicId: posts.publicId,
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
    publicId: string;
    summary: string;
    coverPath: string | null;
    publishedAt: Date | null;
    authorUsername: string;
    authorName: string;
  }[],
): RssPost[] {
  return rows.flatMap((r) =>
    r.title && r.publishedAt
      ? [{ ...r, title: r.title, publishedAt: r.publishedAt }]
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
  // 转义 LIKE 通配符：q="%" 会退化为全表 ilike 顺序扫描（低成本放大）
  const escaped = needle.replace(/[\\%_]/g, "\\$&");
  const like = `%${escaped}%`;
  return db
    .select({
      post: posts,
      author: { username: users.username, displayName: users.displayName, avatarPath: users.avatarPath },
      pollId: polls.id,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
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
): Promise<FeedItemDTO[]> {
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
  return rows.map(toFeedItemDTO);
}
