import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================= enums ================================== */

export const userRoleEnum = pgEnum("user_role", ["user", "editor", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const postTypeEnum = pgEnum("post_type", ["article", "short"]);
export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "pending_review",
  "published",
  "rejected",
  "deleted",
]);
/** private = 仅作者自见（作者在右上角菜单切换；public/followers 面向他人） */
export const postVisibilityEnum = pgEnum("post_visibility", ["public", "followers", "private"]);
export const tokenTypeEnum = pgEnum("token_type", ["email_verify", "password_reset"]);
export const keywordSeverityEnum = pgEnum("keyword_severity", ["block", "warn"]);
export const reportStatusEnum = pgEnum("report_status", ["open", "resolved", "dismissed"]);

/* ============================= users ================================== */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** 换绑邮箱：待确认的新地址（验证邮件确认后替换 email） */
    pendingEmail: varchar("pending_email", { length: 320 }),
    passwordHash: text("password_hash"), // null ⇒ OAuth/SSO-only account
    username: varchar("username", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    bio: varchar("bio", { length: 200 }).default("").notNull(), // 一句话介绍
    avatarPath: text("avatar_path"),
    coverPath: text("cover_path"),
    website: varchar("website", { length: 320 }),
    github: varchar("github", { length: 120 }),
    orcid: varchar("orcid", { length: 40 }),
    role: userRoleEnum("role").default("user").notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    locale: varchar("locale", { length: 8 }).default("zh").notNull(),
    /** membership tier (VIP1 = free); upgrade hooks live in src/lib/tiers.ts */
    tier: integer("tier").default(1).notNull(),
    /** approved verification badge: { type, label, approvedAt } */
    verified: jsonb("verified").$type<{ type: string; label: string; approvedAt: string } | null>(),
    /** timed ban: non-null future timestamp = banned until then */
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    banReason: text("ban_reason"),
    /** blog theme selection: { id?, options?, customCss? } — incremental overrides */
    theme: jsonb("theme").$type<{
      id?: string;
      options?: Record<string, unknown>;
      customCss?: string;
    }>(),
    /** appearance customization (fonts/background/accent) applied to own pages */
    appearance: jsonb("appearance")
      .$type<{
        homeBg?: string | null; // css color or image url
        postBg?: string | null;
        accent?: string | null;
        fontFamily?: string | null;
        fontSize?: "sm" | "md" | "lg" | null;
      }>()
      .default({})
      .notNull(),
    /** sidebar widget selection */
    widgets: jsonb("widgets").$type<string[]>().default([]).notNull(),
    /** 扩展注册的自定义资料字段值（键 = ProfileFieldDef.key，如 ext.signature.tagline） */
    customFields: jsonb("custom_fields")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    /** 用户级扩展设置（键 = 扩展 id，值经 manifest 收敛） */
    extSettings: jsonb("ext_settings")
      .$type<Record<string, Record<string, unknown>>>()
      .default({})
      .notNull(),
    /** 注册后引导流程完成时间（null = 未完成，登录后引导进入 /onboarding） */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    // per-user feature switches
    rssEnabled: boolean("rss_enabled").default(true).notNull(),
    commentsEnabled: boolean("comments_enabled").default(true).notNull(),
    dmEnabled: boolean("dm_enabled").default(true).notNull(),
    // privacy: 列表/收藏对外的可见范围 public | followers | friends | private
    followersVisibility: varchar("followers_visibility", { length: 12 })
      .default("public")
      .notNull(),
    followingVisibility: varchar("following_visibility", { length: 12 })
      .default("public")
      .notNull(),
    bookmarksVisibility: varchar("bookmarks_visibility", { length: 12 })
      .default("private")
      .notNull(),
    // subdomain (deprecated — replaced by username-mode profile URLs)
    subdomain: varchar("subdomain", { length: 63 }),
    subdomainUpdatedAt: timestamp("subdomain_updated_at", { withTimezone: true }),
    /** last time the user changed their username (30-day cooldown) */
    usernameUpdatedAt: timestamp("username_updated_at", { withTimezone: true }),
    /** per-user notification preferences: { [key: string]: channel[] } overrides */
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, string[]>>(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_username_key").on(t.username),
    // 昵称全站唯一（不区分大小写）—— @提及按昵称解析的唯一性前提
    uniqueIndex("users_display_name_key").on(sql`lower(${t.displayName})`),
    uniqueIndex("users_subdomain_key").on(t.subdomain),
    index("users_created_at_idx").on(t.createdAt),
  ],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_provider_account_key").on(t.provider, t.providerAccountId),
    index("oauth_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** true until the mandatory TOTP challenge is passed */
    pending2fa: boolean("pending_2fa").default(false).notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * 绝对寿命上限：签发后无论滑动续期与否都强制过期（重登）。
     * null（历史行）⇒ 由代码回落到 created_at + config.auth.sessionAbsoluteDays。
     */
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * 一次性挑战键（passkey challenge jti 等）：签发时写入（带 TTL），验证时以
 * 原子消费（GETDEL / DELETE RETURNING）实现重放防护。Redis 为一级驱动，
 * 本表是 Redis 不可用时的 PG 后备；过期行由 maintenance.retention cron 清理。
 */
export const oneTimeChallenges = pgTable(
  "one_time_challenges",
  {
    key: varchar("key", { length: 200 }).primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("one_time_challenges_expires_idx").on(t.expiresAt)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: tokenTypeEnum("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_key").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId)],
);

/** @提及记录：内容(@提及解析) → 被提及用户；内容可见后 flush 通知 */
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: uuid("target_id").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("mentions_user_idx").on(t.userId),
    index("mentions_target_idx").on(t.targetType, t.targetId),
    // 同一目标对同一用户只记一条：三处写入点都用 onConflictDoNothing，但
    // 此前无唯一约束可冲突 ⇒ 该语句形同装饰，重试/并发写入会让行数无界增长。
    uniqueIndex("mentions_user_target_key").on(t.userId, t.targetType, t.targetId),
  ],
);

export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(), // base32
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** sha256 hashes of unused recovery codes */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().default([]).notNull(),
  /** 防重放：最近一次成功使用的 TOTP 时间步（unix epoch / 30）；同一窗口内 code 只允许用一次 */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
});

/** WebAuthn 通行密钥（Passkey）凭据 — 用户可注册多把，credentialId 全站唯一 */
export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** base64url(WebAuthn credential ID)，注册时由认证器生成 */
    credentialId: text("credential_id").notNull(),
    /** base64url(COSE 公钥) — 验签用 */
    publicKey: text("public_key").notNull(),
    /** 签名计数器（防克隆检测；认证器不支持时恒 0） */
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").$type<string[]>().default([]).notNull(),
    /** multiDevice（同步到密钥串/云）| singleDevice（仅本机） */
    deviceType: varchar("device_type", { length: 32 }).notNull().default("singleDevice"),
    backedUp: boolean("backed_up").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("passkey_credentials_cid_key").on(t.credentialId),
    index("passkey_credentials_user_idx").on(t.userId),
  ],
);


/** 分布式限流（固定窗口计数；进程内 Map 的 PG 后备，多 worker 共享阈值）— 无外键，过期行由 retention cron 清理 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: varchar("key", { length: 200 }).primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [index("rate_limits_window_idx").on(t.windowStart)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 16 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("invites_code_key").on(t.code), index("invites_creator_idx").on(t.createdBy)],
);

/* ============================ bookmarks ================================== */

/** 收藏：用户稍后想回来看的帖子（评论/转推/点赞之外的独立维度）。 */
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("bookmarks_user_post_key").on(t.userId, t.postId),
    index("bookmarks_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/* ============================ content ================================= */

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }).default("").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("collections_user_slug_key").on(t.userId, t.slug)],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: postTypeEnum("type").default("article").notNull(),
    /**
     * 对外短 ID（permalink 用）：17 位纯数字字符串（56 位 CSPRNG，见
     * src/lib/public-id.ts 的说明 —— Twitter 式数字串、去序列化防顺序抓取）。
     * 内部主键仍为 uuid，不对外暴露。列默认值是同熵的 SQL 兜底（非应用
     * 插入路径的种子/导入也能拿到合法值）；应用路径一律用 newPublicId()。
     */
    publicId: varchar("public_id", { length: 20 })
      .notNull()
      .unique()
      .default(sql`lpad((('x' || substr(md5(random()::text), 1, 14)))::bit(56)::bigint::text, 17, '0')`),
    title: varchar("title", { length: 200 }),
    summary: varchar("summary", { length: 500 }).default("").notNull(),
    content: text("content").default("").notNull(), // markdown source
    coverPath: text("cover_path"), // featured image (webp, in media storage)
    collectionId: uuid("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),
    status: postStatusEnum("status").default("draft").notNull(),
    visibility: postVisibilityEnum("visibility").default("public").notNull(),
    /** content annotation (Douyin-style): original | ai_assisted | repost | opinion */
    label: varchar("label", { length: 24 }).default("original").notNull(),
    sourceUrl: text("source_url"),
    sourceName: varchar("source_name", { length: 200 }),
    rejectReason: text("reject_reason"),
    moderation: jsonb("moderation").$type<{
      keyword?: { severity: string; hits: string[] };
      llm?: { approved: boolean; score?: number; reason?: string };
      reviewedAt?: string;
      reviewedBy?: string;
    }>(),
    views: integer("views").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    repostCount: integer("repost_count").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** recycle bin — set when status = 'deleted'; null for live posts */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** status the post had before it was moved to the recycle bin */
    preDeleteStatus: varchar("pre_delete_status", { length: 24 }),
  },
  (t) => [
    // 社区/探索/话题/站点 feed：等值 (status, visibility) + publishedAt 排序
    index("posts_feed_idx")
      .on(t.status, t.visibility, t.publishedAt.desc()),
    // 个人页 tabs / 作者视角：等值 (authorId, status[, type]) + publishedAt 排序
    index("posts_author_feed_idx").on(t.authorId, t.status, t.publishedAt.desc()),
  ],
);

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }).default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("topics_slug_key").on(t.slug)],
);

export const postTopics = pgTable(
  "post_topics",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.topicId] }),
    index("post_topics_topic_idx").on(t.topicId),
  ],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    path: text("path").notNull(), // relative under storage/media
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 80 }).default("image/webp").notNull(),
    size: integer("size").default(0).notNull(),
    width: integer("width").default(0).notNull(),
    height: integer("height").default(0).notNull(),
    alt: varchar("alt", { length: 300 }).default("").notNull(),
    kind: varchar("kind", { length: 20 }).default("inline").notNull(), // inline|avatar|cover|featured
    /** 存储驱动：local（本地磁盘 storage/media）| r2（Cloudflare R2）—— 按行分派读/删 */
    storage: varchar("storage", { length: 10 }).default("local").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("media_user_idx").on(t.userId, t.createdAt)],
);

/* ============================= social ================================= */

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 16 }).notNull(), // post | comment
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    index("likes_target_idx").on(t.targetType, t.targetId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToCommentId: uuid("reply_to_comment_id"),
    replyToUserId: uuid("reply_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // visible|hidden|deleted|pending_review|rejected — 后两者为审核管线状态（仅作者自见）
    status: varchar("status", { length: 16 }).default("visible").notNull(),
    /** 作者可见性控制：public = 公开；private = 仅自己可见（与审核状态正交） */
    visibility: varchar("visibility", { length: 8 }).default("public").notNull(),
    /** 审核结果（关键词命中 / LLM 结论），结构同 posts.moderation */
    moderation: jsonb("moderation").$type<{
      keyword?: { severity: string; hits: string[] };
      llm?: { approved: boolean; score?: number; reason?: string };
      reviewedAt?: string;
      reviewedBy?: string;
    }>(),
    likeCount: integer("like_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * 博主置顶（单槽：置顶新评论时清同帖其它置顶）。置顶评论在列表首页
     * 排最前（Discourse 式 floats-to-top）。
     */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** 博主标记的解决方案（可多个，Discourse Solve 式）；展示绿勾徽标 */
    solutionAt: timestamp("solution_at", { withTimezone: true }),
  },
  (t) => [index("comments_post_idx").on(t.postId, t.createdAt)],
);

export const reposts = pgTable(
  "reposts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    comment: varchar("comment", { length: 280 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("reposts_user_post_key").on(t.userId, t.postId),
    index("reposts_post_idx").on(t.postId),
  ],
);

/** Discourse-style emoji reactions on posts — a user may react with many
 * distinct emoji, but only once per emoji. */
export const postReactions = pgTable(
  "post_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("post_reactions_post_user_emoji_key").on(t.postId, t.userId, t.emoji),
    index("post_reactions_post_idx").on(t.postId),
  ],
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("conversations_pair_key").on(t.userAId, t.userBId),
    index("conversations_user_a_idx").on(t.userAId),
    index("conversations_user_b_idx").on(t.userBId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body"),
    mediaPath: text("media_path"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    // 未读私信相关查询全部带 read_at IS NULL —— 部分索引体积恒小
    index("messages_unread_idx").on(t.conversationId).where(sql`read_at is null`),
  ],
);

/* ========================== verification ============================== */

export const verificationRequests = pgTable(
  "verification_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(), // personal | creator | professional | organization
    label: varchar("label", { length: 80 }).notNull(), // badge title, e.g. 前端工程师
    description: varchar("description", { length: 500 }).notNull(),
    attachments: jsonb("attachments").$type<string[]>().default([]).notNull(), // media paths
    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending | approved | rejected
    rejectReason: varchar("reject_reason", { length: 300 }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("verification_user_idx").on(t.userId),
    index("verification_status_idx").on(t.status, t.createdAt),
    // 每用户至多一条 pending：提交前的「查 pending → 插入」不是原子序列，并发双提
    // 会留下两条待审申请，审核人可能对同一身份批出两条 approved 记录（徽章锚点重复、
    // 撤销语义混乱）。部分唯一索引把这条不变式交给数据库，不依赖应用代码记得加锁。
    uniqueIndex("verification_one_pending_key").on(t.userId).where(sql`status = 'pending'`),
  ],
);

/* ========================== notifications ============================= */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 80 }).notNull(), // e.g. comment.created
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx").on(t.userId).where(sql`read_at is null`),
  ],
);

/* ====================== notification delivery ledger =================== */

/**
 * 异步投递的幂等台账（一次投递尝试一行，无业务字段）。
 *
 * WHY：pg-boss 是 at-least-once —— worker 在副作用之后、确认之前崩溃（或 job 超时
 * 被回收）时同一任务会被重投。对 notify.dispatch / event.dispatch 这类「处理器里
 * 还会派站内信、入队邮件、跑监听器」的任务，重投等于把整串副作用再做一遍（用户
 * 收到重复通知与重复邮件）。故入队时生成一个 deliveryKey 随 payload 走，处理器
 * 执行前用 `INSERT … ON CONFLICT DO NOTHING RETURNING` 原子认领：拿到行的那次才
 * 执行，重投拿不到行即空转。键由入队方生成、随 payload 持久化，与 job id 无关，
 * 因此对「重试新建 job 行」的形态同样有效。
 *
 * 表由 maintenance.retention 每日清理 30 天前的行（幂等窗口远大于任何重试跨度）。
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    dedupeKey: varchar("dedupe_key", { length: 96 }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notification_deliveries_created_idx").on(t.createdAt)],
);

/* ============================ webhooks ================================ */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    lastStatus: integer("last_status"),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    failCount: integer("fail_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("webhooks_user_idx").on(t.userId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending|success|failed
    responseCode: integer("response_code"),
    attempts: integer("attempts").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt),
    index("webhook_deliveries_created_idx").on(t.createdAt),
  ],
);

/* ========================== api tokens (MCP) ========================== */

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 12 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_key").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

/* ============================ platform ================================ */

export const settings = pgTable("settings", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const keywords = pgTable(
  "keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    word: varchar("word", { length: 120 }).notNull(),
    severity: keywordSeverityEnum("severity").default("block").notNull(),
    category: varchar("category", { length: 40 }).default("general").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("keywords_word_key").on(t.word)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 20 }).notNull(), // post|comment|user
    targetId: uuid("target_id").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: reportStatusEnum("status").default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("reports_status_idx").on(t.status, t.createdAt),
    // 同一举报人对同一目标只允许一条未处理举报：部分唯一索引既挡住
    // 「重复刷同一目标」（队列噪声 + open 计数虚高），又保留结案后再举报。
    uniqueIndex("reports_open_key")
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`status = 'open'`),
  ],
);

export const modLogs = pgTable(
  "mod_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 可空：null = 系统 actor（自动触发的审计，非人工操作）
    adminId: uuid("admin_id").references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 60 }).notNull(),
    targetType: varchar("target_type", { length: 20 }).notNull(),
    targetId: uuid("target_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mod_logs_created_idx").on(t.createdAt)],
);

/** user-facing export archive build states */
export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 16 }).default("queued").notNull(), // queued|building|done|failed
  filePath: text("file_path"),
  sizeBytes: integer("size_bytes"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("export_jobs_user_idx").on(t.userId, t.createdAt)]);

/* ============================== polls ================================= */

/** 附加在短动态上的投票（一帖一票；随帖子级联删除）。 */
export const polls = pgTable(
  "polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    /** single = 单选，multiple = 多选 */
    mode: varchar("mode", { length: 12 }).default("single").notNull(),
    /** 选项文案，下标与 poll_votes.optionIndex 对齐（2–5 项） */
    options: jsonb("options").$type<string[]>().notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** poll.end 任务派发完结果通知后置位（幂等标记） */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("polls_post_id_key").on(t.postId)],
);

/** 投票记录：单选一行；多选每个选中项一行。 */
export const pollVotes = pgTable(
  "poll_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    optionIndex: integer("option_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("poll_votes_unique").on(t.pollId, t.userId, t.optionIndex),
  ],
);

/* ============================= types ================================== */

export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Poll = typeof polls.$inferSelect;

// 扩展数据表聚合（extensions/<id>/schema.ts → _boot/tables.ts）
export * from "@/extensions/_boot/tables";
