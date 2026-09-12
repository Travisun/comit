import { createHooks } from "hookable";

/**
 * Global hook system (WordPress/Laravel-style actions & filters) built on
 * `hookable`. Extension points are called with a typed-ish context; listeners
 * may mutate the context object (filters) or just react (actions).
 *
 * Registered extension points:
 *  - "post:render"      { html, post, author }   → filter rendered article HTML
 *  - "post:excerpt"     { excerpt, post }        → filter summary text
 *  - "sidebar:widgets"  { widgets, owner }       → register profile sidebar widgets
 *  - "admin:menu"       { sections }             → add admin panel sections
 *  - "mcp:tools"        { tools }                → register MCP tools
 *  - "feed:query"       { where }                → filter feed query conditions
 *  - "notification:channels" { channels }        → register notification channels
 *  - "user:deleting"    { userId }               → react to account deletion
 */
export const hooks = createHooks();

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
