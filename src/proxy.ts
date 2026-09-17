import { NextRequest, NextResponse } from "next/server";
import { RESERVED_USERNAMES } from "@/lib/username-policy";

/**
 * Edge middleware:
 *  1. Username-mode profile URLs: `/{username}` ⇒ `/u/{username}` for any
 *     single path segment that is not a reserved top-level route or a file
 *     (contains a dot). Multi-segment paths never match, so /explore,
 *     /u/alice, /post/[slug]… keep their canonical handlers.
 *  2. Security headers (X-Frame-Options / X-Content-Type-Options /
 *     Referrer-Policy) 已收敛到 next.config.ts 的 headers() —— 该处覆盖面含
 *     /api 与静态资源（本 matcher 排除的路径也覆盖），此处不再双源重复。
 *
 * 保留字单一来源：src/lib/username-policy.ts 的 RESERVED_USERNAMES
 * （与注册/改名校验共享，历史缺陷是此处硬编码独立清单导致「sub 可注册但
 * /sub 被 proxy 保留 → 规范地址永久 404」的路由遮蔽）。
 * 这里仅叠加框架/结构性的本地例外：
 *  - _next：框架路径（用户名规则字母开头天然排除，此处防御性保留）；
 *  - vditor：public/ 下第三方编辑器静态资源目录。
 */
const LOCAL_ROUTE_ONLY = new Set(["_next", "vditor"]);
const RESERVED = new Set([...RESERVED_USERNAMES, ...LOCAL_ROUTE_ONLY]);

export function proxy(req: NextRequest) {
  const url = req.nextUrl;

  let res: NextResponse;
  // 字符集与注册口径（username-policy isValidUsername）的并集对齐：
  // 字母/数字/下划线/连字符 —— 缺连字符时 OAuth 生成的 john-doe 类用户名
  // 的规范地址 /john-doe 永远 404（2026-09 审计确认的 P0 级数据正确性缺陷）。
  // 含 "." 的路径天然不匹配（robots.txt / manifest.webmanifest 等文件）。
  const m = url.pathname.match(/^\/([A-Za-z0-9_-]+)$/);
  if (m && !RESERVED.has(m[1].toLowerCase())) {
    // 用户名模式：/{username} → 用户空间（用户名统一小写存储）
    const rewriteUrl = url.clone();
    rewriteUrl.pathname = `/u/${m[1].toLowerCase()}`;
    res = NextResponse.rewrite(rewriteUrl);
  } else {
    res = NextResponse.next();
  }

  return res;
}

export const config = {
  // api/** 全部排除：单段重写正则对多段 API 路径本就永不可能命中，
  // 让每个 API 请求都过一遍 middleware 纯属开销。
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
