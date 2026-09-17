import { routes } from "@/core/routes";
import type { FeedItemDTO } from "./types";

/**
 * Shared permalink resolver for timeline cards. Lives in its own server-safe
 * module: server components (ShortCard) and client components (ArticleCard)
 * both call it, and a plain function exported from a "use client" module
 * cannot be invoked from the server.
 */
export function postHref(post: FeedItemDTO["post"]): string {
  // canonical：/post/{internalId}（短动态与长文统一；slug 旧链接仍由
  // /post/[slug] 路由兼容解析）
  return routes.post(post.publicId);
}
