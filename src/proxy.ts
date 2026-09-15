import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware:
 *  1. Username-mode profile URLs: `/{username}` ⇒ `/u/{username}` for any
 *     single path segment that is not a reserved top-level route or a file
 *     (contains a dot). Multi-segment paths never match, so /explore,
 *     /u/alice, /post/[slug]… keep their canonical handlers.
 *  2. Security headers.
 */
const RESERVED_TOP_LEVEL = new Set([
  // app pages & routers（与 /{username} 冲突的顶级路径一律保留）
  "about", "api", "app", "archive", "auth", "explore", "feed", "following",
  "icons", "images", "img", "legal", "login", "logout", "manifest", "media",
  "messages", "notifications", "p", "post", "robots", "register", "rss",
  "settings", "sitemap", "static", "sub", "topics", "u", "upload", "write",
  "admin", "assets", "cdn", "docs", "search", "account", "console", "blog",
  "help", "support", "status", "verify", "reset", "forgot", "2fa", "_next",
]);

export function proxy(req: NextRequest) {
  const url = req.nextUrl;

  let res: NextResponse;
  const m = url.pathname.match(/^\/([A-Za-z0-9_]+)$/);
  if (m && !RESERVED_TOP_LEVEL.has(m[1].toLowerCase())) {
    // 用户名模式：/{username} → 用户空间
    const rewriteUrl = url.clone();
    rewriteUrl.pathname = `/u/${m[1].toLowerCase()}`;
    res = NextResponse.rewrite(rewriteUrl);
  } else {
    res = NextResponse.next();
  }

  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/oauth|api/mcp).*)"],
};
