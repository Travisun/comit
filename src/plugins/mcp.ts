import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, users, media, comments, topics, postTopics, collections } from "@/db/schema";
import {
  registerMcpTool,
  type McpToolDef,
  type McpToolContext,
  type Plugin,
} from "@/core/plugins/types";
import { emit } from "@/core/events";
import { uniqueSlug } from "@/lib/users";
import { makeExcerpt } from "@/lib/utils";
import { preSubmitCheck, reviewPost } from "@/lib/moderation";
import { getSetting } from "@/lib/settings";

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
          slug: posts.slug,
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
        slug: row.post.slug,
        content: row.post.content,
        status: row.post.status,
        author: { username: row.author.username, displayName: row.author.displayName },
      };
    },
  ),
  tool(
    "create_article",
    "Create a new article (markdown) owned by the authenticated user and submit it through the review pipeline.",
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
      const title = String(args.title).slice(0, 200);
      const content = String(args.content);
      const [post] = await db
        .insert(posts)
        .values({
          authorId: ctx.userId,
          type: "article",
          title,
          slug: await uniqueSlug(ctx.userId, title),
          summary: String(args.summary ?? "") || makeExcerpt(content),
          content,
          status: "draft",
          visibility: args.visibility === "followers" ? "followers" : "public",
          collectionId: args.collectionId ? String(args.collectionId) : null,
        })
        .returning();
      const topicNames = (Array.isArray(args.topics) ? args.topics : []).slice(0, 5);
      for (const name of topicNames) {
        const slug = String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || `t-${Date.now()}`;
        const [topic] = await db
          .insert(topics)
          .values({ slug: `${slug}-${Math.random().toString(36).slice(2, 6)}`, name: String(name) })
          .onConflictDoNothing()
          .returning();
        const t =
          topic ??
          (await db.select().from(topics).where(eq(topics.name, String(name))).limit(1))[0];
        if (t) await db.insert(postTopics).values({ postId: post.id, topicId: t.id }).onConflictDoNothing();
      }
      if (args.publishNow !== false) {
        const check = await preSubmitCheck(title, content);
        if (check.blocked.length) {
          await db.update(posts).set({ status: "rejected", rejectReason: `命中黑名单关键词: ${check.blocked.join(", ")}` }).where(eq(posts.id, post.id));
          return { id: post.id, status: "rejected", blockedKeywords: check.blocked };
        }
        await db.update(posts).set({ status: "pending_review" }).where(eq(posts.id, post.id));
        const [fresh] = await db.select().from(posts).where(eq(posts.id, post.id)).limit(1);
        const outcome = await reviewPost(fresh);
        return { id: post.id, status: outcome.status, reason: outcome.reason };
      }
      return { id: post.id, status: "draft" };
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
    "Delete one of the authenticated user's posts permanently.",
    ["posts:write"],
    { type: "object", required: ["postId"], properties: { postId: { type: "string" } } },
    async (args, ctx) => {
      const rows = await db
        .delete(posts)
        .where(and(eq(posts.id, String(args.postId)), eq(posts.authorId, ctx.userId)))
        .returning({ id: posts.id });
      return { deleted: rows.length > 0 };
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
        .where(and(eq(comments.postId, String(args.postId)), eq(comments.status, "visible")))
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
  register(ctx) {
    for (const t of TOOLS) registerMcpTool(t);
  },
};

export default plugin;
