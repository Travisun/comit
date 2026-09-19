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
import { confiscateBannedUser } from "@/lib/banned";
import { renderMarkdown } from "@/lib/markdown/server";
import { getWornBadgesByUsernames } from "@/extensions/badges/server";
import { escapeLikePattern } from "@/lib/utils";
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

export type FeedItem = {
  post: Post;
  author: UserBrief;
  /** 非空 ⇒ 该帖附带投票 */
  pollId?: string | null;
  /** viewer 已收藏（仅 getPublishedPosts 传 viewerId 时下发） */
  bookmarked?: boolean;
};

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
      status: item.post.status,
      views: item.post.views,
      likeCount: item.post.likeCount,
      commentCount: item.post.commentCount,
      repostCount: item.post.repostCount,
      publishedAt: item.post.publishedAt ? item.post.publishedAt.toISOString() : null,
      label: item.post.label,
      sourceUrl: item.post.sourceUrl,
      sourceName: item.post.sourceName,
      hasPoll: Boolean(item.pollId),
      bookmarked: Boolean(item.bookmarked),
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
  /** 传入 ⇒ 每行附带 viewer 的收藏状态（bookmarked），供行内收藏按钮渲染 */
  viewerId?: string | null;
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

  // 先发后审的自见语义：登录作者的信息流里包含自己的 待审/未通过 内容
  // （带状态标签仅自己可见），其他用户只见 已发布+公开
  const viewerId = opts.viewerId ?? null;
  const conds = [
    viewerId
      ? or(
          and(eq(posts.status, "published"), eq(posts.visibility, "public")),
          and(
            eq(posts.authorId, viewerId),
            inArray(posts.status, ["pending_review", "rejected"]),
          ),
        )!
    : and(eq(posts.status, "published"), eq(posts.visibility, "public")),
  ];
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

  // 传入 viewerId 时 LEFT JOIN 收藏表：行内附带 viewer 的收藏态（收藏按钮初始状态）
  const baseQuery = db
    .select({
      post: posts,
      author: {
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
        status: users.status,
        bannedUntil: users.bannedUntil,
      },
      pollId: polls.id,
      bookmarked: opts.viewerId
        ? sql<boolean>`(${bookmarks.userId} is not null)`
        : sql<boolean>`false`,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id));
  const rows = await (opts.viewerId
    ? baseQuery.leftJoin(
        bookmarks,
        and(eq(bookmarks.postId, posts.id), eq(bookmarks.userId, opts.viewerId)),
      )
    : baseQuery
  )
    .where(and(...conds))
    .orderBy(desc(posts.publishedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const pageRows = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    ...r,
    author: confiscateBannedUser(r.author),
  }));

  // 先发后审不影响：佩戴徽章批量注入（按 username 分组，≤3 枚）
  const badgeMap = await getWornBadgesByUsernames(pageRows.map((r) => r.author.username));
  const items = pageRows.map((r) => ({
    ...r,
    author: { ...r.author, badges: badgeMap.get(r.author.username) },
  }));
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
            author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          },
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
        author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          },
        pollId: polls.id,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(polls, eq(polls.postId, posts.id))
      .where(extra)
      .orderBy(desc(score))
      .limit(limit);

  type RawAuthor = FeedItem["author"] & { status: string; bannedUntil: Date | null };
  const confiscate = (rows: { post: Post; author: RawAuthor; pollId?: string | null }[]) =>
    rows.map((r) => ({ ...r, author: confiscateBannedUser(r.author) }));
  const recent = await baseQuery(and(...base, gte(posts.publishedAt, new Date(Date.now() - 30 * DAY))));
  if (recent.length >= limit) return confiscate(recent);
  return confiscate(await baseQuery(and(...base)));
}

/** Hot posts of one author (for the sidebar "hot-posts" widget). */
export async function getUserHotPosts(userId: string, limit = 5): Promise<FeedItem[]> {
  const rows = await db
    .select({
      post: posts,
      author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          },
      pollId: polls.id,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
    .where(and(eq(posts.authorId, userId), eq(posts.status, "published"), eq(posts.visibility, "public")))
    .orderBy(desc(sql`(${posts.views} + ${posts.likeCount} * 3)`))
    .limit(limit);
  return rows.map((r) => ({ ...r, author: confiscateBannedUser(r.author) }));
}

/* ------------------------------- trending --------------------------------- */

/** 热门榜时间窗：今日 24h / 本周 7d / 本月 30d（滚动窗口）。 */
export type HotRange = "day" | "week" | "month";

const HOT_RANGE_MS: Record<HotRange, number> = {
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
};

/**
 * 新鲜度重力：分母 (发布小时数 + 2)^gravity。窗口越短 gravity 越大 ——
 * 日榜只奖励「刚发生」的互动，月榜则让整个窗口内的爆款都能浮上来。
 * （Hacker News 式衰减；+2 抗发布零点的除零奇点。）
 */
const HOT_GRAVITY: Record<HotRange, number> = { day: 1.4, week: 1.0, month: 0.6 };

/**
 * 榜单 ID 池长度 + 缓存：排名计算一次（每 range 一次聚合扫描），30s 内的
 * 分页/并发请求直接切片，避免每次翻页都全表聚合。站点量级下 200 条足够
 * 覆盖整月榜的前几页。
 */
const HOT_POOL_SIZE = 200;
const HOT_CACHE_TTL_MS = 30_000;
const hotPoolCache = new Map<HotRange, { at: number; ids: string[] }>();

/**
 * 热门评分（时间窗内互动加权，全站内容社交模型定制）：
 *
 *   score = (转发×6 + 点赞×4 + 评论×3 + 收藏×2 + 浏览×0.2 + 1)
 *           / (发布小时数 + 2) ^ gravity
 *
 * 设计依据：
 *  - 互动计数取明细表（likes/comments/reposts/bookmarks.created_at）在窗口
 *    内的发生量，而非 posts 表的全期累计列 —— 昨天发布、今天被顶起的帖子
 *    在「今日榜」应排前面；views 无明细表，以低权重（0.2）用全期列参与。
 *  - 权重按社交传导强度排序：转发（公开展示到关注者时间线）> 点赞（公开、
 *    低成本）> 评论（公开、高成本）> 收藏（私有信号，仅体现内容价值）。
 *    +1 平滑零互动新帖，让纯新帖也有出场机会（再被 gravity 压下去）。
 */
async function hotPostIds(range: HotRange): Promise<string[]> {
  const cached = hotPoolCache.get(range);
  if (cached && Date.now() - cached.at < HOT_CACHE_TTL_MS) return cached.ids;

  const since = new Date(Date.now() - HOT_RANGE_MS[range]);
  const result = await db.execute(sql`
    WITH l AS (
      SELECT ${likes.targetId} AS post_id, count(*)::int AS n
      FROM ${likes}
      WHERE ${likes.targetType} = 'post' AND ${likes.createdAt} >= ${since}
      GROUP BY ${likes.targetId}
    ),
    c AS (
      SELECT ${comments.postId} AS post_id, count(*)::int AS n
      FROM ${comments}
      WHERE ${comments.status} = 'visible' AND ${comments.createdAt} >= ${since}
      GROUP BY ${comments.postId}
    ),
    r AS (
      SELECT ${reposts.postId} AS post_id, count(*)::int AS n
      FROM ${reposts}
      WHERE ${reposts.createdAt} >= ${since}
      GROUP BY ${reposts.postId}
    ),
    b AS (
      SELECT ${bookmarks.postId} AS post_id, count(*)::int AS n
      FROM ${bookmarks}
      WHERE ${bookmarks.createdAt} >= ${since}
      GROUP BY ${bookmarks.postId}
    )
    SELECT p.id AS id
    FROM ${posts} p
    LEFT JOIN l ON l.post_id = p.id
    LEFT JOIN c ON c.post_id = p.id
    LEFT JOIN r ON r.post_id = p.id
    LEFT JOIN b ON b.post_id = p.id
    WHERE p.status = 'published'
      AND p.visibility = 'public'
      AND p.published_at >= ${since}
    ORDER BY (
      (coalesce(l.n, 0) * 4 + coalesce(c.n, 0) * 3 + coalesce(r.n, 0) * 6
        + coalesce(b.n, 0) * 2 + p.views * 0.2 + 1)
      / power(greatest(extract(epoch FROM (now() - p.published_at)) / 3600.0, 0) + 2,
              ${HOT_GRAVITY[range]})
    ) DESC, p.published_at DESC
    LIMIT ${HOT_POOL_SIZE}
  `);
  const ids = (result.rows as { id: string }[]).map((r) => r.id);
  hotPoolCache.set(range, { at: Date.now(), ids });
  return ids;
}

/**
 * 热门榜（日/周/月）分页查询 — 供 /hot 页面与 /api/hot 使用。
 * 排名在 ID 池阶段完成，这里按 offset 切片后回填完整的 Feed 行
 * （作者信息、投票标记、viewer 收藏态），行为与 getPublishedPosts 对齐。
 */
export async function getTrendingPosts(opts: {
  range: HotRange;
  limit?: number;
  offset?: number;
  viewerId?: string | null;
}): Promise<{ items: FeedItem[]; nextOffset: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const ids = await hotPostIds(opts.range);
  const pageIds = ids.slice(offset, offset + limit);
  if (pageIds.length === 0) return { items: [], nextOffset: null };

  const baseQuery = db
    .select({
      post: posts,
      author: {
        username: users.username,
        displayName: users.displayName,
        avatarPath: users.avatarPath,
        status: users.status,
        bannedUntil: users.bannedUntil,
      },
      pollId: polls.id,
      bookmarked: opts.viewerId
        ? sql<boolean>`(${bookmarks.userId} is not null)`
        : sql<boolean>`false`,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id));
  const rows = await (opts.viewerId
    ? baseQuery.leftJoin(
        bookmarks,
        and(eq(bookmarks.postId, posts.id), eq(bookmarks.userId, opts.viewerId)),
      )
    : baseQuery
  )
    .where(inArray(posts.id, pageIds));

  const byId = new Map<string, FeedItem>();
  for (const r of rows) {
    byId.set(r.post.id, { ...r, author: confiscateBannedUser(r.author) });
  }
  const items = pageIds
    .map((id) => byId.get(id))
    .filter((x): x is FeedItem => x !== undefined);
  return { items, nextOffset: offset + limit < ids.length ? offset + limit : null };
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

/** 任意状态取用户（/u/[username] 封禁主页标注用；deleted 仍返回，由调用方分支）。 */
export async function getUserByUsernameAnyStatus(username: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
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

/** 用户的收藏列表（新→旧，offset 分页），带作者信息供卡片渲染。 */
export async function listBookmarkPosts(
  userId: string,
  limit = 10,
  offset = 0,
): Promise<{ items: FeedItemDTO[]; nextOffset: number | null }> {
  const rows = await db
    .select({
      post: posts,
      author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          },
      pollId: polls.id,
    })
    .from(bookmarks)
    .innerJoin(posts, eq(posts.id, bookmarks.postId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(polls, eq(polls.postId, posts.id))
    .where(and(eq(bookmarks.userId, userId), eq(posts.status, "published")))
    .orderBy(desc(bookmarks.createdAt))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  // DAL 出口即 DTO：杜绝 Date/全文 db 行对象经类型注解漂移到客户端
  return {
    items: rows.slice(0, limit).map((r) => toFeedItemDTO({ ...r, author: confiscateBannedUser(r.author) })),
    nextOffset: hasMore ? offset + limit : null,
  };
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

export async function getUserCollections(
  userId: string,
  limit = 12,
  offset = 0,
): Promise<{ items: CollectionCardData[]; nextOffset: number | null }> {
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
    .orderBy(collections.sortOrder, desc(collections.createdAt))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((r) => ({ ...r, postCount: Number(r.postCount) })),
    nextOffset: hasMore ? offset + limit : null,
  };
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
  if (!viewerId) return { liked: false, reposted: false, bookmarked: false };
  const [l, r, b] = await Promise.all([
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
    db
      .select({ x: bookmarks.userId })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, viewerId), eq(bookmarks.postId, postId)))
      .limit(1),
  ]);
  return { liked: l.length > 0, reposted: r.length > 0, bookmarked: b.length > 0 };
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
    // 没收展示：封禁中的作者隐藏头像、昵称统一为「已封禁用户」
    author: confiscateBannedUser(author),
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
  id: string;
  title: string;
  publicId: string;
  summary: string;
  /** 渲染后的完整 HTML（content:encoded，阅读器可全文阅读） */
  contentHtml: string;
  topics: string[];
  coverPath: string | null;
  publishedAt: Date;
  authorUsername: string;
  authorName: string;
}

function rssSelection() {
  return {
    id: posts.id,
    type: posts.type,
    title: posts.title,
    content: posts.content,
    publicId: posts.publicId,
    summary: posts.summary,
    coverPath: posts.coverPath,
    publishedAt: posts.publishedAt,
    authorUsername: users.username,
    authorName: users.displayName,
  };
}

const rssConds = [eq(posts.status, "published"), eq(posts.visibility, "public")];

type RssSeed = Omit<RssPost, "topics" | "contentHtml"> & { content: string };

function toRssPosts(
  rows: {
    id: string;
    publicId: string;
    type: "article" | "short";
    title: string | null;
    content: string;
    summary: string;
    coverPath: string | null;
    publishedAt: Date | null;
    authorUsername: string;
    authorName: string;
  }[],
): RssSeed[] {
  return rows.flatMap((r) => {
    if (!r.publishedAt) return [];
    // 短动态无标题：截取内容首行作为条目标题（微博式 feed 的通行做法）
    const title = r.title ?? (r.content || r.summary).split("\n")[0].slice(0, 40);
    return [{
      id: r.id,
      publicId: r.publicId,
      type: r.type,
      title,
      content: r.content,
      summary: r.summary,
      coverPath: r.coverPath,
      publishedAt: r.publishedAt,
      authorUsername: r.authorUsername,
      authorName: r.authorName,
    }];
  });
}

/** 附加话题分类与全文 HTML（RSS content:encoded，阅读器内全文可读）。 */
async function decorateRssPosts(rows: RssSeed[]): Promise<RssPost[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const topicRows = await db
    .select({ postId: postTopics.postId, name: topics.name })
    .from(postTopics)
    .innerJoin(topics, eq(topics.id, postTopics.topicId))
    .where(inArray(postTopics.postId, ids));
  const byPost = new Map<string, string[]>();
  for (const t of topicRows) {
    byPost.set(t.postId, [...(byPost.get(t.postId) ?? []), t.name]);
  }
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      topics: byPost.get(r.id) ?? [],
      contentHtml: (await renderMarkdown(r.content)).html,
    })),
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
  return decorateRssPosts(toRssPosts(rows));
}

export async function getUserRssPosts(userId: string, limit = 40): Promise<RssPost[]> {
  const rows = await db
    .select(rssSelection())
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(...rssConds, eq(posts.authorId, userId)))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
  return decorateRssPosts(toRssPosts(rows));
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

/** 粉丝/关注列表分页大小（与个人主页其他 tab 对齐） */
export const FOLLOWS_PAGE_SIZE = 24;

/** People who follow the given user (粉丝) — offset 分页。 */
export async function listFollowers(
  userId: string,
  limit = FOLLOWS_PAGE_SIZE,
  offset = 0,
): Promise<{ items: UserCard[]; nextOffset: number | null }> {
  const rows = await db
    .select(userCardSelection)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followeeId, userId), eq(users.status, "active")))
    .orderBy(desc(follows.createdAt))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  return {
    items: (hasMore ? rows.slice(0, limit) : rows) as UserCard[],
    nextOffset: hasMore ? offset + limit : null,
  };
}

/** People the given user follows (关注中) — offset 分页。 */
export async function listFollowing(
  userId: string,
  limit = FOLLOWS_PAGE_SIZE,
  offset = 0,
): Promise<{ items: UserCard[]; nextOffset: number | null }> {
  const rows = await db
    .select(userCardSelection)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followeeId))
    .where(and(eq(follows.followerId, userId), eq(users.status, "active")))
    .orderBy(desc(follows.createdAt))
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  return {
    items: (hasMore ? rows.slice(0, limit) : rows) as UserCard[],
    nextOffset: hasMore ? offset + limit : null,
  };
}

/** Author's best-performing articles — the brand "代表作" strip. */
/** Published + public posts matching a free-text query (explore search). */
export async function searchPublishedPosts(q: string, limit = 20): Promise<FeedItem[]> {
  const needle = q.trim().slice(0, 80);
  if (!needle) return [];
  const like = `%${escapeLikePattern(needle)}%`;
  const rows = await db
    .select({
      post: posts,
      author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          },
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
  return rows.map((r) => ({ ...r, author: confiscateBannedUser(r.author) }));
}

export async function getTopPosts(
  userId: string,
  limit = 2,
): Promise<FeedItemDTO[]> {
  const rows = await db
    .select({ post: posts, author: {
            username: users.username,
            displayName: users.displayName,
            avatarPath: users.avatarPath,
            status: users.status,
            bannedUntil: users.bannedUntil,
          } })
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
  return rows.map((r) => toFeedItemDTO({ ...r, author: confiscateBannedUser(r.author) }));
}
