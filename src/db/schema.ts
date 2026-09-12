import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  integer,
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
]);
export const postVisibilityEnum = pgEnum("post_visibility", ["public", "followers"]);
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
    // per-user feature switches
    rssEnabled: boolean("rss_enabled").default(true).notNull(),
    commentsEnabled: boolean("comments_enabled").default(true).notNull(),
    dmEnabled: boolean("dm_enabled").default(true).notNull(),
    // subdomain
    subdomain: varchar("subdomain", { length: 63 }),
    subdomainUpdatedAt: timestamp("subdomain_updated_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
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

export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(), // base32
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** sha256 hashes of unused recovery codes */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().default([]).notNull(),
});

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
    slug: varchar("slug", { length: 180 }),
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
  },
  (t) => [
    uniqueIndex("posts_author_slug_key").on(t.authorId, t.slug),
    index("posts_author_status_idx").on(t.authorId, t.status),
    index("posts_published_idx").on(t.publishedAt),
    index("posts_status_idx").on(t.status),
    {
      name: "posts_search_idx",
      columns: [sql`to_tsvector('simple', coalesce(${t.title},'') || ' ' || ${t.content})`],
      using: "gin",
    } as never,
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
    status: varchar("status", { length: 16 }).default("visible").notNull(), // visible|hidden|deleted
    likeCount: integer("like_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
  (t) => [uniqueIndex("reposts_user_post_key").on(t.userId, t.postId)],
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
  (t) => [uniqueIndex("conversations_pair_key").on(t.userAId, t.userBId)],
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
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
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
  (t) => [index("verification_user_idx").on(t.userId), index("verification_status_idx").on(t.status, t.createdAt)],
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
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
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
  (t) => [index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
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
  (t) => [index("reports_status_idx").on(t.status, t.createdAt)],
);

export const modLogs = pgTable(
  "mod_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
});

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
