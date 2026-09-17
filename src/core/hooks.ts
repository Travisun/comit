import { createHooks } from "hookable";

/**
 * Global hook system (WordPress/Laravel-style actions & filters) built on
 * `hookable`. Extension points are called with a typed-ish context; listeners
 * may mutate the context object (filters) or just react (actions).
 *
 * Registered extension points (payload 形状以 HookPayloadMap 为准；未登记的
 * hook 走开放分支，仍可经 `hooks.callHook` / `callHook` 调用):
 *  - "post:render"      { html }                 → filter rendered article HTML
 *    （文章详情页的 post/author/viewer 管线在 core/capabilities/post-render.ts，
 *    不走此 hook；此处只暴露 markdown 渲染产物）
 *  - "post:excerpt"     { excerpt, post }        → filter summary text
 *  - "sidebar:widgets"  { widgets, owner }       → register profile sidebar widgets
 *  - "admin:menu"       { sections }             → add admin panel sections
 *  - "mcp:tools"        { tools }                → register MCP tools
 *  - "feed:query"       { where }                → filter feed query conditions
 *  - "notification:channels" { channels }        → register notification channels
 *  - "user:deleting"    { userId, … reject() }   → react to account deletion
 */
export const hooks = createHooks();

/** 已验证 payload 形状的 hook（新增 hook 落地时在此登记，逐步收窄开放分支）。 */
export interface HookPayloadMap {
  /** markdown/server.ts 渲染产物过滤器 — 监听者可原地改写 `ctx.html` */
  "post:render": { html: string };
  /** 登录请求后（auth 解析完成、before handler） */
  "request:user": { userId: string; path: string };
  /** API 请求入口（withApi 入口、before handler） */
  "request:api": { method: string; path: string; ip: string };
  /** 帖子创建后（含草稿/提交） */
  "post:created": { post: { id: string; type: string; authorId: string; status: string } };
  /** 帖子更新后 */
  "post:updated": { post: { id: string; status: string }; prevStatus: string };
  /** 帖子删除后（软删/硬删均触发） */
  "post:deleted": { postId: string; authorId: string };
  /** 评论删除后 */
  "comment:deleted": { commentId: string; postId: string };
  /** 媒体删除后 */
  "media:deleted": { mediaId: string; userId: string };
  /** 关注状态变化（followed = true 新关注 / false 取关） */
  "follow:changed": { followerId: string; followeeId: string; following: boolean };
}

export type HookName =
  | "post:render"
  | "post:excerpt"
  | "sidebar:widgets"
  | "admin:menu"
  | "mcp:tools"
  | "feed:query"
  | "notification:channels"
  | "user:deleting"
  | (string & {});

/** 已登记 key → HookPayloadMap 形状；未登记的开放 key → 宽松对象。 */
type HookPayloadFor<K extends HookName> =
  K extends keyof HookPayloadMap ? HookPayloadMap[K] : Record<string, unknown>;

/**
 * Typed `callHook` — 已知 key 的 payload 受 HookPayloadMap 约束（键名与形状
 * 均有补全/检查），未知 key 保持开放。监听者通过 `hooks.hook(name, fn)` 注册。
 */
export function callHook<K extends HookName>(name: K, payload: HookPayloadFor<K>): Promise<void> {
  return hooks.callHook(name, payload as never) as Promise<void>;
}
