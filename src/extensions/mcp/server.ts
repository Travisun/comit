import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, users, media, comments, topics, postTopics, collections } from "@/db/schema";
import {
  registerMcpTool,
  type McpToolDef,
  type Plugin,
} from "@/core/plugins/types";
import { emit } from "@/core/events";
import { AppError } from "@/core/errors";
import { escapeLikePattern, makeExcerpt, slugifyTitle } from "@/lib/utils";
import { preSubmitCheck } from "@/lib/moderation";
import { mentionTokensToPlainText } from "@/lib/mentions";
import { getInteractablePost } from "@/lib/interactions";
import { deleteMediaFile } from "@/lib/media";
import { asStorageTag } from "@/lib/storage";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";

/**
 * MCP plugin — exposes the platform to LLM agents over the Model Context
 * Protocol (endpoint /api/mcp, Bearer token auth). Tools cover reading and
 * writing posts, media, comments and the community feed.
 *
 * 错误约定：工具层面向调用方的可读错误一律抛 AppError —— transport 只回显
 * AppError.message，其余异常（DB/内部）以泛化消息返回，防 SQL/约束/路径泄露。
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

/* ------------------------- 入参加固助手（MCP 面） ------------------------- */

/** inputSchema 只是对客户端的声明（SDK 不做运行时校验），越界的字符串/数字
 * 会一路进 SQL 与 varchar 列（超长触发 PG 错误、非 uuid 触发 22P02）。
 * 以下助手在 handler 入口补齐运行时校验，语义对齐 web 路由的 zod schema。 */

/** 与 web posts 路由 zod 同款的字段上限。extensions 不 import app-route 模块
 *（既有惯例，见 resolvePostPublicId 注释），数值与 _shared.ts 手工保持同步。 */
const TITLE_MAX = 200;
const SUMMARY_MAX = 500; // posts.summary = varchar(500)
const CONTENT_MAX = 200_000;
const SHORT_CONTENT_MAX = 8000; // 与 _shared.ts SHORT_CONTENT_MAX 一致
const QUERY_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(msg: string): never {
  throw new AppError(msg, 400, "bad_request");
}

/** 资源 id 必须是合法 uuid：挡掉非 uuid 输入直达 PG（22P02 错误虽已被
 * transport 泛化，但白白消耗一次查询与 500 路径）。 */
function requireUuid(field: string, value: unknown): string {
  const s = typeof value === "string" ? value : "";
  if (!UUID_RE.test(s)) badRequest(`${field} must be a valid uuid / 必须是合法 id`);
  return s;
}

/** 分页数字归一：非法值回默认，钳制到 [min, max]（limit 无上限 = 拖库 DoS）。 */
function intArg(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

/** 必填字符串：类型/长度双检（不接受数字数组等被 String() 静默转换的怪值）。 */
function requireString(field: string, value: unknown, max: number): string {
  if (typeof value !== "string") badRequest(`${field} must be a string / 必须是字符串`);
  const s = value as string;
  if (s.length > max) badRequest(`${field} exceeds ${max} characters / 超出长度上限`);
  return s;
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
  if (!row) throw new AppError("collection not found or not yours", 404, "not_found");
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

/** 导出仅供单测直取 handler（register 走 registerMcpTool 注册表，不依赖此导出）。 */
export const TOOLS: McpToolDef[] = [
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
      if (!["draft", "pending_review", "published", "rejected", "all"].includes(status)) {
        badRequest('status must be one of "draft" | "pending_review" | "published" | "rejected" | "all"');
      }
      const limit = intArg(args.limit, 20, 1, 100);
      const offset = intArg(args.offset, 0, 0, 100_000);
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
    "Get one post's full markdown content by id. The caller's own posts are readable in any lifecycle state; other people's posts only when published and visible to the caller (public, or followers-only if the caller follows the author).",
    ["posts:read"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
    async (args, ctx) => {
      const postId = requireUuid("postId", args.postId);
      const row = await postWithAuthor(postId);
      if (!row) throw new AppError("post not found", 404, "not_found");
      // 与 web GET /api/posts/[id] 同口径：作者任意状态可读；他人仅
      // published + 对其可见（public / followers-已关注），草稿、回收站、
      // 私有内容一律按不存在处理 —— 防止 token 越权读取任意草稿/已删帖。
      if (row.post.authorId !== ctx.userId) {
        await getInteractablePost(row.post.id, ctx.userId);
      }
      return {
        id: row.post.id,
        type: row.post.type,
        title: row.post.title,
        publicId: row.post.publicId,
        // mention 稳定引用对 agent 无意义（且回写时 processMentions 会重新命中）：
        // 输出可读 @昵称，不把引用语法字面量交给调用方
        content: await mentionTokensToPlainText(row.post.content),
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
      // 与 web POST /api/posts 同桶同主体（write.post 按 userId 计数，入队
      // 即扣配额）：MCP 发布不得比 web 宽松 —— 否则 60 req/min 的 token 桶
      // 会变成绕过「每小时 10 篇」发帖限额的后门。
      await rateLimitBucket("write.post", ctx.userId);

      // 与 web POST /api/posts 对齐的基本校验：文章必须有标题与内容，
      // 长度上限同 web zod schema（超长此前会直达 varchar 列触发 PG 错误）
      const title = requireString("title", args.title, TITLE_MAX).trim();
      const content = requireString("content", args.content, CONTENT_MAX);
      if (!title) throw new AppError("文章必须有标题 / Articles require a title", 400, "validation_error");
      if (!content.trim()) throw new AppError("文章内容不能为空 / Article content cannot be empty", 400, "validation_error");
      if (args.summary !== undefined) requireString("summary", args.summary, SUMMARY_MAX).trim();
      const summary =
        (args.summary !== undefined ? (args.summary as string).trim() : "") || makeExcerpt(content);
      if (args.visibility !== undefined && !["public", "followers"].includes(String(args.visibility))) {
        badRequest('visibility must be "public" or "followers"');
      }
      const collectionId =
        args.collectionId !== undefined && args.collectionId !== null && args.collectionId !== ""
          ? requireUuid("collectionId", args.collectionId)
          : null;
      if (collectionId) await assertCollectionOwned(collectionId, ctx.userId);

      const submit = args.publishNow !== false;

      // 硬关键词门禁与 web 创建语义一致：命中即拒绝、不落库（web 为 422，
      // 工具侧以 error 结果返回，调用方可看到被拦关键词）
      if (submit) {
        const { blocked } = await preSubmitCheck(title, content);
        if (blocked.length) {
          throw new AppError(`内容包含被禁止的关键词：${blocked.join("、")}`, 422, "blocked_keywords");
        }
      }

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
            collectionId,
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
    "Update an existing post's title/content/summary (must be owned by the caller). Editing a published post re-enters the moderation pipeline (status goes back to pending_review, same as the web editor).",
    ["posts:write"],
    {
      type: "object",
      required: ["postId"],
      properties: {
        postId: { type: "string", format: "uuid" },
        title: { type: "string" },
        content: { type: "string" },
        summary: { type: "string" },
      },
    },
    async (args, ctx) => {
      const postId = requireUuid("postId", args.postId);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (args.title !== undefined) {
        const title = requireString("title", args.title, TITLE_MAX).trim();
        if (!title) badRequest("标题不能为空 / Title cannot be empty");
        patch.title = title;
      }
      if (args.content !== undefined) {
        patch.content = requireString("content", args.content, CONTENT_MAX);
      }
      if (args.summary !== undefined) {
        patch.summary = requireString("summary", args.summary, SUMMARY_MAX).trim();
      }
      if (Object.keys(patch).length === 1) badRequest("没有可更新的字段 / No fields to update");

      // 归属预读（对照 web getAuthorPost：不存在/非本人/回收站一律 404，
      // 回收站的恢复与彻底清除只走 web 专用端点）
      const [post] = await db
        .select({ id: posts.id, type: posts.type, status: posts.status })
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.authorId, ctx.userId),
            ne(posts.status, "deleted"),
          ),
        )
        .limit(1);
      if (!post) throw new AppError("post not found or not yours", 404, "not_found");

      // 短动态正文上限与 web PUT 同口径（超长内容会被无条件覆写进
      // 短动态行，必须在落库前挡下）
      if (
        post.type === "short" &&
        typeof patch.content === "string" &&
        patch.content.length > SHORT_CONTENT_MAX
      ) {
        badRequest(`短动态内容不能超过 ${SHORT_CONTENT_MAX} 字`);
      }

      // 审核闭环与 web PUT 一致：已发布内容的任何编辑都回到 pending_review
      // 重走审核管线（旧实现直接改 published 行 = 绕过审核发布新内容），
      // 过审后由 moderation 插件恢复发布并照常触发下游钩子
      const wasPublished = post.status === "published";
      if (wasPublished) {
        patch.status = "pending_review";
        patch.rejectReason = null;
      }

      // 条件更新带 authorId 绑定（对象级授权：token 属主只能改自己的行）
      const rows = await db
        .update(posts)
        .set(patch)
        .where(and(eq(posts.id, postId), eq(posts.authorId, ctx.userId)))
        .returning({ id: posts.id });
      if (!rows.length) throw new AppError("post not found or not yours", 404, "not_found");

      if (wasPublished) {
        await emit("post:submitted", {
          postId: rows[0].id,
          authorId: ctx.userId,
          title: typeof patch.title === "string" ? patch.title : "",
          needReview: true,
        });
      }
      return {
        id: rows[0].id,
        updated: true,
        status: wasPublished ? "pending_review" : post.status,
      };
    },
  ),
  tool(
    "delete_post",
    "Move one of the authenticated user's posts to the recycle bin (soft delete, restorable from the web UI). Posts already in the recycle bin are reported as not found.",
    ["posts:write"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string", format: "uuid" } } },
    async (args, ctx) => {
      const postId = requireUuid("postId", args.postId);
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
            eq(posts.id, postId),
            eq(posts.authorId, ctx.userId),
            ne(posts.status, "deleted"),
          ),
        )
        .returning({ id: posts.id });
      if (!deleted) throw new AppError("post not found or not yours", 404, "not_found");
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
      const q = (args.query === undefined ? "" : requireString("query", args.query, QUERY_MAX)).trim();
      if (!q) return { posts: [] };
      const limit = intArg(args.limit, 10, 1, 50);
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
            or(ilike(posts.title, `%${escapeLikePattern(q)}%`), ilike(posts.content, `%${escapeLikePattern(q)}%`)),
          ),
        )
        .orderBy(desc(posts.publishedAt))
        .limit(limit);
      return { posts: rows };
    },
  ),
  tool(
    "get_feed",
    "Browse the community feed (recent published public posts and short posts).",
    ["feed:read"],
    { type: "object", properties: { limit: { type: "number", default: 20, maximum: 50 }, offset: { type: "number", default: 0 } } },
    async (args) => {
      const limit = intArg(args.limit, 20, 1, 50);
      const offset = intArg(args.offset, 0, 0, 100_000);
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
        .limit(limit)
        .offset(offset);
      return { feed: rows };
    },
  ),
  tool(
    "list_my_media",
    "List the authenticated user's media library (WebP images).",
    ["media:read"],
    { type: "object", properties: { limit: { type: "number", default: 50, maximum: 200 } } },
    async (args, ctx) => {
      const limit = intArg(args.limit, 50, 1, 200);
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
        .limit(limit);
      return { media: rows };
    },
  ),
  tool(
    "delete_media",
    "Delete a media file from the authenticated user's library (removes the library row and the underlying file).",
    ["media:write"],
    { type: "object", required: ["mediaId"], properties: { mediaId: { type: "string", format: "uuid" } } },
    async (args, ctx) => {
      const mediaId = requireUuid("mediaId", args.mediaId);
      // 对象级授权：查询即绑定 userId，他人 mediaId 查不到 → 不泄露存在性
      const [row] = await db
        .select({ id: media.id, path: media.path, storage: media.storage })
        .from(media)
        .where(and(eq(media.id, mediaId), eq(media.userId, ctx.userId)))
        .limit(1);
      if (!row) return { deleted: false };
      await db.delete(media).where(eq(media.id, row.id));
      // 与 admin DELETE /api/admin/media/[id] 同款：连物理对象一起删
      // （存储不可用时 deleteMediaFile 内部转 cleanup 队列补偿）
      await deleteMediaFile(row.path, asStorageTag(row.storage));
      return { deleted: true };
    },
  ),
  tool(
    "list_post_comments",
    "List comments on a post (only comments the caller may see).",
    ["comments:read"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string" }, limit: { type: "number", default: 50 } } },
    async (args, ctx) => {
      const postId = requireUuid("postId", args.postId);
      const limit = intArg(args.limit, 50, 1, 200);
      // 隐藏内容门控：他人草稿/回收站/私有帖的评论不可经 MCP 读取
      const [p] = await db
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);
      if (!p) throw new AppError("post not found", 404, "not_found");
      if (p.authorId !== ctx.userId) await getInteractablePost(postId, ctx.userId);
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
            eq(comments.postId, postId),
            eq(comments.status, "visible"),
            eq(comments.visibility, "public"),
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(limit);
      // 评论体同 get_post：mention 语法拉平为可读 @昵称
      return {
        comments: await Promise.all(
          rows.map(async (r) => ({ ...r, body: await mentionTokensToPlainText(r.body) })),
        ),
      };
    },
  ),
  tool(
    "get_profile",
    "Get the authenticated user's profile.",
    ["profile:read"],
    { type: "object", properties: {} },
    async (_args, ctx) => {
      const [user] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
      // token 级联删除晚于用户删除等竞态下可能查不到行：显式 404，不靠运行时崩溃
      // （崩溃会走 transport 泛化路径，但静默 TypeError 会白白消耗 500）
      if (!user) throw new AppError("account not found or deactivated", 404, "not_found");
      // 返回投影只含公开资料字段：passwordHash/totpSecret/email/settings 等
      // 敏感列一律不带出（select() 全行只用于取值，不外发）
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
