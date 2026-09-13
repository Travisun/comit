import { config } from "./config";

/**
 * Named route registry (Laravel `route()` equivalent). All internal links are
 * generated through this so path shapes change in one place. Subdomain-aware
 * absolute helpers live at the bottom.
 */
export const routes = {
  // public
  home: "/",
  feed: "/feed",
  explore: "/explore",
  topic: (slug: string) => `/topics/${slug}`,
  archive: () => "/archive",

  // auth
  login: "/auth/login",
  register: "/auth/register",
  verifyEmail: "/auth/verify",
  forgotPassword: "/auth/forgot",
  resetPassword: (token: string) => `/auth/reset?token=${encodeURIComponent(token)}`,
  twofaSetup: "/auth/2fa/setup",
  twofaChallenge: "/auth/2fa/challenge",
  oauthStart: (provider: string) => `/api/auth/oauth/${provider}`,
  oauthCallback: (provider: string) => `/api/auth/oauth/callback/${provider}`,
  discourseSso: "/api/auth/sso/discourse",

  // user space (path-based; rewritten from subdomains by middleware)
  profile: (username: string) => `/u/${username}`,
  profileTab: (username: string, tab: "posts" | "short" | "collections" | "about") =>
    `/u/${username}?tab=${tab}`,
  post: (username: string, slug: string) => `/u/${username}/posts/${slug}`,
  /** Canonical article permalink — opaque short id, author-independent. */
  article: (idOrSlug: string) => `/post/${idOrSlug}`,
  collection: (username: string, slug: string) => `/u/${username}/collections/${slug}`,
  shortPost: (id: string) => `/p/${id}`,
  userRss: (username: string) => `/u/${username}/feed.xml`,

  // creator
  editorNew: (type: "article" | "short" = "article") =>
    type === "article" ? "/write" : "/write?type=short",
  editorEdit: (postId: string) => `/write/${postId}`,

  // user settings
  settings: () => "/settings/profile",
  settingsTab: (tab: string) => `/settings/${tab}`,
  notifications: "/notifications",
  messages: "/messages",
  conversation: (userId: string) => `/messages/${userId}`,

  // admin
  admin: (path = "") => `/admin${path}`,

  // assets / data
  media: (relativePath: string) => `/api/media/file/${relativePath}`,
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
