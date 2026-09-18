import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, users, media, comments, topics, postTopics, collections } from "@/db/schema";
import {
  registerMcpTool,
  type McpToolDef,
  type Plugin,
} from "@/core/plugins/types";
import { emit } from "@/core/events";
import { makeExcerpt, slugifyTitle } from "@/lib/utils";
import { preSubmitCheck } from "@/lib/moderation";

/**
 * MCP plugin — exposes the platform to LLM agents over the Model Context
 * Protocol (endpoint /api/mcp, Bearer token auth). Tools cover reading and
 * writing posts, media, comments and the community feed.
 */

function tool(
  name: string,
  description: string,
  scopes: string[],
  inputSchema: Record<string, unknown>,
  handler: McpToolDef["handler"],
): McpToolDef {
  return { name, description, scopes, inputSchema, handler };
}

async function postWithAuthor(postId: string) {
  const [row] = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(posts.id, postId))
    .limit(1);
  return row;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resolve a fresh slug for a new article — same semantics as the canonical
 * `resolveArticleSlug` in src/app/api/posts/_shared.ts: an opaque 10-char
 * url-safe short id (nanoid), deduped within the author's slug namespace
 * (matching posts_author_slug_key), with a longer fallback after repeated
 * clashes. Local copy on purpose: extensions don't import app-route modules.
 * 与 web 同款：服务端生成的 opaque short id，客户端/工具参数提供的 slug 按设计忽略。
 */
async function resolvePostPublicId(): Promise<string> {
  // 列默认值熵有限；应用路径显式 CSPRNG 生成（lib/public-id.ts）
  const { newPublicId } = await import("@/lib/public-id");
  return newPublicId();
}

/**
 * Topic slug normalization — mirrors `normalizeSlug` in _shared.ts
 * (slugifyTitle strips CJK → keep the lowercased name as fallback; slug is
 * CJK-safe). The slug IS the topic identity: same slug reuses the existing
 * row instead of spawning a duplicate per call (the old Math.random suffix
 * created a new topic row on every MCP create_article).
 */
function normalizeTopicSlug(name: string): string {
  const fallback = name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 100);
  const s = slugifyTitle(name);
  const out = (s.startsWith("post-") && !name.match(/^[a-z0-9]/i) ? fallback : s).replace(
    /[^a-z0-9\u4e00-\u9fff-]/gi,
    "",
  );
  return out || fallback || `t-${Date.now().toString(36)}`;
}

/** Upsert topics by slug (≤5) and link them to the post — `_shared.syncPostTopics` 同款语义. */
async function syncPostTopics(tx: Tx, postId: string, names: string[]): Promise<void> {
  const seen = new Set<string>();
  const cleaned: { name: string; slug: string }[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) continue;
    const slug = normalizeTopicSlug(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    cleaned.push({ name, slug });
  }
  for (const t of cleaned) {
    await tx.insert(topics).values({ slug: t.slug, name: t.name }).onConflictDoNothing({
      target: topics.slug,
    });
  }
  const rows = cleaned.length
    ? await tx.select().from(topics).where(inArray(topics.slug, cleaned.map((t) => t.slug)))
    : [];
  if (rows.length) {
    await tx
      .insert(postTopics)
      .values(rows.map((r) => ({ postId, topicId: r.id })))
      .onConflictDoNothing();
  }
}

/** 合集归属校验（对照 _shared.assertCollectionOwned：不存在/非本人 → 报错）。 */
async function assertCollectionOwned(collectionId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .limit(1);
  if (!row) throw new Error("collection not found or not yours");
}

/**
 * 变更类工具名单 — 与上方 TOOLS 定义逐一核对后的写操作集合（写库 / 删文件）：
 * create_article / update_post / delete_post（posts:write）+ delete_media
 * （media:write）。其余 list/search/get 类工具均为只读。/api/mcp 路由在站点
 * 维护期间据此拦截 tools/call（只读工具与 tools/list 等元方法照常放行）。
 * 名单放在 TOOLS 旁边是有意的：新增写工具时改两处相邻代码，不易漏。
 */
export const MCP_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "create_article",
  "update_post",
  "delete_post",
  "delete_media",
]);

const TOOLS: McpToolDef[] = [
  tool(
    "list_my_posts",
    "List the authenticated user's posts (articles and short posts), newest first.",
    ["posts:read"],
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "pending_review", "published", "rejected", "all"], default: "all" },
        limit: { type: "number", default: 20, maximum: 100 },
        offset: { type: "number", default: 0 },
      },
    },
    async (args, ctx) => {
      const status = String(args.status ?? "all");
      const limit = Math.min(Number(args.limit ?? 20), 100);
      const offset = Number(args.offset ?? 0);
      const conds = [eq(posts.authorId, ctx.userId)];
      if (status !== "all") conds.push(eq(posts.status, status as never));
      const rows = await db
        .select({
          id: posts.id,
          type: posts.type,
          title: posts.title,
          publicId: posts.publicId,
          summary: posts.summary,
          status: posts.status,
          likeCount: posts.likeCount,
          viewCount: posts.views,
          publishedAt: posts.publishedAt,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(and(...conds))
        .orderBy(desc(posts.createdAt))
        .limit(limit)
        .offset(offset);
      return { posts: rows };
    },
  ),
  tool(
    "get_post",
    "Get one post's full markdown content by id.",
    ["posts:read"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string" } } },
    async (args) => {
      const row = await postWithAuthor(String(args.postId));
      if (!row) throw new Error("post not found");
      return {
        id: row.post.id,
        type: row.post.type,
        title: row.post.title,
        publicId: row.post.publicId,
        content: row.post.content,
        status: row.post.status,
        author: { username: row.author.username, displayName: row.author.displayName },
      };
    },
  ),
  tool(
    "create_article",
    "Create a new article (markdown) owned by the authenticated user. publishNow=false saves a draft; otherwise the article enters the same submit/review pipeline as the web editor (pre-submit keyword gate → pending_review → the moderation plugin publishes or queues review).",
    ["posts:write"],
    {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Markdown body" },
        summary: { type: "string" },
        topics: { type: "array", items: { type: "string" }, maxItems: 5 },
        collectionId: { type: "string" },
        visibility: { type: "string", enum: ["public", "followers"], default: "public" },
        publishNow: { type: "boolean", default: true, description: "false ⇒ save as draft" },
      },
    },
    async (args, ctx) => {
      // 与 web POST /api/posts 对齐的基本校验：文章必须有标题与内容
      const title = String(args.title).trim().slice(0, 200);
      const content = String(args.content);
      if (!title) throw new Error("文章必须有标题 / Articles require a title");
      if (!content.trim()) throw new Error("文章内容不能为空 / Article content cannot be empty");
      if (args.collectionId) await assertCollectionOwned(String(args.collectionId), ctx.userId);

      const submit = args.publishNow !== false;

      // 硬关键词门禁与 web 创建语义一致：命中即拒绝、不落库（web 为 422，
      // 工具侧以 error 结果返回，调用方可看到被拦关键词）
      if (submit) {
        const { blocked } = await preSubmitCheck(title, content);
        if (blocked.length) {
          throw new Error(`内容包含被禁止的关键词：${blocked.join("、")}`);
        }
      }

      const summary = String(args.summary ?? "") || makeExcerpt(content);
      const topicNames = (Array.isArray(args.topics) ? args.topics : [])
        .map((n) => String(n))
        .slice(0, 5);

      // 单事务覆盖 post + topics + 关联，任一失败整体回滚（对照 POST /api/posts）
      const post = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(posts)
          .values({
            authorId: ctx.userId,
            type: "article",
            title,
            publicId: await resolvePostPublicId(),
            summary,
            content,
            status: submit ? "pending_review" : "draft",
            visibility: args.visibility === "followers" ? "followers" : "public",
            collectionId: args.collectionId ? String(args.collectionId) : null,
          })
          .returning();
        await syncPostTopics(tx, row.id, topicNames);
        return row;
      });

      if (!submit) return { id: post.id, publicId: post.publicId, status: "draft" };

      // 提交流程与 web 一致：只 emit post:submitted，由 moderation 插件决定
      // 直接发布（reviewMode=off）或入队审核 —— 不在创建路径内联 reviewPost
      // （旧实现绕过审核流与 post:publishing 钩子，发布口径和 web 不一致）。
      await emit("post:submitted", {
        postId: post.id,
        authorId: ctx.userId,
        title,
        needReview: true,
      });
      // emit 返回后终态已定（同进程监听器同步执行）：published 或 pending_review
      const [fresh] = await db
        .select({ status: posts.status })
        .from(posts)
        .where(eq(posts.id, post.id))
        .limit(1);
      return { id: post.id, publicId: post.publicId, status: fresh?.status ?? "pending_review" };
    },
  ),
  tool(
    "update_post",
    "Update an existing post's title/content/summary (must be owned by the caller).",
    ["posts:write"],
    {
      type: "object",
      required: ["postId"],
      properties: {
        postId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        summary: { type: "string" },
      },
    },
    async (args, ctx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (args.title !== undefined) patch.title = String(args.title).slice(0, 200);
      if (args.content !== undefined) patch.content = String(args.content);
      if (args.summary !== undefined) patch.summary = String(args.summary);
      const rows = await db
        .update(posts)
        .set(patch)
        .where(and(eq(posts.id, String(args.postId)), eq(posts.authorId, ctx.userId)))
        .returning({ id: posts.id });
      if (!rows.length) throw new Error("post not found or not yours");
      return { id: rows[0].id, updated: true };
    },
  ),
  tool(
    "delete_post",
    "Move one of the authenticated user's posts to the recycle bin (soft delete, restorable from the web UI). Posts already in the recycle bin are reported as not found.",
    ["posts:write"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string" } } },
    async (args, ctx) => {
      // 与 web DELETE /api/posts/[id]（不带 ?purge=true）同款软删：
      // status=deleted + preDeleteStatus + deletedAt，保留评论/点赞，可从回收站
      // 恢复；已删除的行视为不存在（回收站的恢复/彻底清除走 web 专用端点）。
      //
      // 条件更新防并发（对照 admin approve 路由的写法）：不做先 select 后
      // update 的两步写 —— 那样与 web 回收站「恢复」并发时会把已恢复的文章
      // 再次置 deleted，并以 select 时点的旧状态覆写 preDeleteStatus。改为单条
      // UPDATE ... WHERE status <> 'deleted' + returning 判空，0 行即「不存在
      // 或已删除」，与原 not-found 语义一致；preDeleteStatus 在同一语句内引用
      // status 列旧值（Postgres SET 右侧取更新前的行值），保证快照准确。
      const [deleted] = await db
        .update(posts)
        .set({
          status: "deleted",
          preDeleteStatus: sql`${posts.status}`,
          deletedAt: new Date(),
        })
        .where(
          and(
            eq(posts.id, String(args.postId)),
            eq(posts.authorId, ctx.userId),
            ne(posts.status, "deleted"),
          ),
        )
        .returning({ id: posts.id });
      if (!deleted) throw new Error("post not found or not yours");
      return { id: deleted.id, deleted: true, status: "deleted" };
    },
  ),
  tool(
    "search_posts",
    "Search published posts across the platform by keyword (title + body).",
    ["feed:read"],
    {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number", default: 10, maximum: 50 } },
    },
    async (args) => {
      const q = String(args.query ?? "").trim();
      if (!q) return { posts: [] };
      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          summary: posts.summary,
          author: users.username,
          publishedAt: posts.publishedAt,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(
          and(
            eq(posts.status, "published"),
            eq(posts.visibility, "public"),
            or(ilike(posts.title, `%${q}%`), ilike(posts.content, `%${q}%`)),
          ),
        )
        .orderBy(desc(posts.publishedAt))
        .limit(Math.min(Number(args.limit ?? 10), 50));
      return { posts: rows };
    },
  ),
  tool(
    "get_feed",
    "Browse the community feed (recent published public posts and short posts).",
    ["feed:read"],
    { type: "object", properties: { limit: { type: "number", default: 20, maximum: 50 }, offset: { type: "number", default: 0 } } },
    async (args) => {
      const rows = await db
        .select({
          id: posts.id,
          type: posts.type,
          title: posts.title,
          summary: posts.summary,
          author: users.username,
          authorName: users.displayName,
          likeCount: posts.likeCount,
          commentCount: posts.commentCount,
          publishedAt: posts.publishedAt,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(and(eq(posts.status, "published"), eq(posts.visibility, "public")))
        .orderBy(desc(posts.publishedAt))
        .limit(Math.min(Number(args.limit ?? 20), 50))
        .offset(Number(args.offset ?? 0));
      return { feed: rows };
    },
  ),
  tool(
    "list_my_media",
    "List the authenticated user's media library (WebP images).",
    ["media:read"],
    { type: "object", properties: { limit: { type: "number", default: 50, maximum: 200 } } },
    async (args, ctx) => {
      const rows = await db
        .select({
          id: media.id,
          filename: media.filename,
          path: media.path,
          size: media.size,
          width: media.width,
          height: media.height,
          createdAt: media.createdAt,
        })
        .from(media)
        .where(eq(media.userId, ctx.userId))
        .orderBy(desc(media.createdAt))
        .limit(Math.min(Number(args.limit ?? 50), 200));
      return { media: rows };
    },
  ),
  tool(
    "delete_media",
    "Delete a media file from the authenticated user's library.",
    ["media:write"],
    { type: "object", required: ["mediaId"], properties: { mediaId: { type: "string" } } },
    async (args, ctx) => {
      const rows = await db
        .delete(media)
        .where(and(eq(media.id, String(args.mediaId)), eq(media.userId, ctx.userId)))
        .returning({ id: media.id });
      return { deleted: rows.length > 0 };
    },
  ),
  tool(
    "list_post_comments",
    "List comments on a post.",
    ["comments:read"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string" }, limit: { type: "number", default: 50 } } },
    async (args) => {
      const rows = await db
        .select({
          id: comments.id,
          body: comments.body,
          author: users.username,
          createdAt: comments.createdAt,
          likeCount: comments.likeCount,
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.userId))
        .where(
          and(
            eq(comments.postId, String(args.postId)),
            eq(comments.status, "visible"),
            eq(comments.visibility, "public"),
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(Math.min(Number(args.limit ?? 50), 200));
      return { comments: rows };
    },
  ),
  tool(
    "get_profile",
    "Get the authenticated user's profile.",
    ["profile:read"],
    { type: "object", properties: {} },
    async (_args, ctx) => {
      const [user] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
      return {
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        github: user.github,
        orcid: user.orcid,
        website: user.website,
        subdomain: user.subdomain,
      };
    },
  ),
  tool(
    "get_stats",
    "Get the authenticated user's content statistics.",
    ["profile:read"],
    { type: "object", properties: {} },
    async (_args, ctx) => {
      const [p] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(eq(posts.authorId, ctx.userId), eq(posts.status, "published")));
      const [m] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(media)
        .where(eq(media.userId, ctx.userId));
      return { publishedPosts: p.n, mediaFiles: m.n };
    },
  ),
];

const plugin: Plugin = {
  name: "mcp",
  description: "Model Context Protocol tools for agent access",
  version: "1.0.0",
  register() {
    for (const t of TOOLS) registerMcpTool(t);
  },
};

export default plugin;
