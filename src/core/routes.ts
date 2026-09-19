import { config } from "./config";

/**
 * Named route registry (Laravel `route()` / urlcat equivalent). All internal
 * links are generated through this so path shapes change in one place.
 *
 * 动态路由统一经 `buildPath` 模板生成（path-to-regexp 风格的 ":param" 段，
 * 参数自动 encodeURIComponent），模板集中在下方 `TPL` —— 路由形状调整
 * 只改模板，所有调用点自动跟随。参考实现：path-to-regexp / urlcat /
 * Laravel route() helpers。
 */

/**
 * 模板化路径生成：":param" 段替换为 encodeURIComponent 后的参数值。
 * 缺参直接抛错（URL 拼错宁可炸在开发期，不带病上线）。
 */
export function buildPath(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
    const v = params[key];
    if (v === undefined || v === null) {
      throw new Error(`[routes] missing param "${key}" for template "${template}"`);
    }
    return encodeURIComponent(String(v));
  });
}

/** 动态路由模板 — URL 形状的唯一出处（结构变更只改这里）。 */
export const TPL = {
  /** 个人主页：/{username}（proxy 把单段路径 rewrite 到 /u/{username}） */
  userProfile: "/:username",
  /** 帖子 permalink：/post/{publicId}（17 位左右数字串，短动态与长文统一；uuid/slug 旧链接兼容解析） */
  post: "/post/:publicId",
  topic: "/topics/:slug",
  userCollection: "/u/:username/collections/:slug",
  userRss: "/:username/feed.xml",
  editorEdit: "/write/:postId",
  conversation: "/messages/:userId",
  resetPassword: "/auth/reset",
  oauthStart: "/api/auth/oauth/:provider",
  oauthCallback: "/api/auth/oauth/callback/:provider",
  media: "/api/media/file/:path",
} as const;

export const routes = {
  // public
  home: "/",
  /** 热门榜（今日/本周/本月，?range= 切换时间窗） */
  hot: "/hot",
  /** 关注流（登录用户关注作者的最新动态） */
  following: "/following",
  feed: "/feed",
  explore: "/explore",
  topic: (slug: string) => buildPath(TPL.topic, { slug }),
  archive: () => "/archive",

  // auth
  login: "/auth/login",
  register: "/auth/register",
  verifyEmail: "/auth/verify",
  forgotPassword: "/auth/forgot",
  resetPassword: (token: string) =>
    `${buildPath(TPL.resetPassword)}?token=${encodeURIComponent(token)}`,
  twofaSetup: "/auth/2fa/setup",
  twofaChallenge: "/auth/2fa/challenge",
  oauthStart: (provider: string) => buildPath(TPL.oauthStart, { provider }),
  oauthCallback: (provider: string) => buildPath(TPL.oauthCallback, { provider }),
  discourseSso: "/api/auth/sso/discourse",

  // user space —— canonical 主页即 /{username}（proxy rewrite 到 /u/{username}，
  // /u/… 直链继续可用；页面 canonical metadata 统一指向短形态）
  profile: (username: string) => buildPath(TPL.userProfile, { username }),
  profileTab: (username: string, tab: "posts" | "short" | "collections" | "about") =>
    `${buildPath(TPL.userProfile, { username })}?tab=${tab}`,
  /**
   * Canonical post permalink — /post/{publicId}（Twitter 式数字短 ID，
   * 见 lib/public-id.ts），短动态与长文统一
   * （uuid/slug 旧链接由 /post/[slug] 路由兼容解析）。
   */
  post: (publicId: string) => buildPath(TPL.post, { publicId }),
  collection: (username: string, slug: string) =>
    buildPath(TPL.userCollection, { username, slug }),
  userRss: (username: string) => buildPath(TPL.userRss, { username }),

  // creator
  editorNew: (type: "article" | "short" = "article") =>
    type === "article" ? "/write" : "/write?type=short",
  editorEdit: (postId: string) => buildPath(TPL.editorEdit, { postId }),

  // user settings
  settings: () => "/settings/profile",
  settingsTab: (tab: string) => `/settings/${tab}`,
  notifications: "/notifications",
  messages: "/messages",
  conversation: (userId: string) => buildPath(TPL.conversation, { userId }),

  // admin
  admin: (path = "") => `/admin${path}`,

  // assets / data
  media: (relativePath: string) =>
    // 逐段编码、保留斜杠：媒体键（shard/shard/uuid/file.webp）天生含斜杠，
    // 走 buildPath 会整段 encodeURIComponent 产生 %2F 形态 URL，客户端从
    // URL 反提路径时将得到编码形态，与服务端存的裸路径精确匹配失败。
    // catch-all [...path] 路由对两种形态都能正确解析。
    `/api/media/file/${relativePath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/")}`,
  globalRss: "/feed.xml",
  sitemap: "/sitemap.xml",
  export: "/api/export",

  legal: {
    terms: "/legal/terms",
    privacy: "/legal/privacy",
  },
} as const;

/** Absolute URL helper for emails / RSS / MCP / webhooks. */
export function absolute(path: string, base?: string): string {
  const b = (base ?? config.app.url).replace(/\/$/, "");
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

function appPort(): string {
  try {
    return new URL(config.app.url).port ? `:${new URL(config.app.url).port}` : "";
  } catch {
    return "";
  }
}

/**
 * Absolute URL for a user-scoped resource, honoring the subdomain feature:
 * when `subdomainBase` is provided and enabled, prefer `https://user.root/post-slug`.
 */
export function userAbsolute(
  opts: { username: string; path?: string; subdomain?: string | null },
  ctx: { subdomainEnabled: boolean; base?: string },
): string {
  const { username, path = "" } = opts;
  if (ctx.subdomainEnabled && opts.subdomain) {
    const root = config.app.rootDomain;
    const scheme = root === "localhost" || root.endsWith(".local") ? "http" : "https";
    return `${scheme}://${opts.subdomain}.${root}${appPort()}${path}`;
  }
  return absolute(routes.profile(username) + path, ctx.base);
}
