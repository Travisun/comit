import type { Metadata } from "next";
import { config } from "@/core/config";
import { getSiteBrand, type SiteBrand } from "@/lib/settings";
import type { User, Post } from "@/db/schema";

/** SEO / GEO metadata helpers — one place for titles, canonicals, OG, robots. */

/** 默认标题：`名称 — 副标题首段`（副标题按破折号取首段，长副标题不进 <title>）。 */
function defaultTitle(brand: SiteBrand): string {
  const head = brand.tagline.split(/[—–]/)[0].trim();
  return head ? `${brand.name} — ${head}` : brand.name;
}

/** 分享图解析：完整 http(s) URL 原样；否则按站内媒体相对路径拼绝对地址。 */
function ogImageUrl(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return `${config.app.url}/api/media/file/${v.replace(/^\/+/, "")}`;
}

/** twitter:site 句柄归一：无 @ 前缀时补上；空值不下发。 */
function twitterSite(handle: string): string | undefined {
  const v = handle.trim();
  if (!v) return undefined;
  return v.startsWith("@") ? v : `@${v}`;
}

/** keywords 设置解析：中英文逗号/分号分隔。 */
function keywordList(raw: string): string[] {
  return raw
    .split(/[,，;；]/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * 全站根 metadata —— 全部取自 admin 可调的站点设置（getSiteBrand，双层缓存）。
 * 由根 layout 的 generateMetadata 每请求求值，后台改名/改描述即时生效
 * （settings 10s TTL 内收敛）。
 */
export async function siteMetadata(): Promise<Metadata> {
  const brand = await getSiteBrand();
  const title = defaultTitle(brand);
  const description = brand.description;
  const images = ogImageUrl(brand.ogImage);
  const site = twitterSite(brand.twitter);
  const robots = brand.noindex
    ? { index: false, follow: false }
    : { index: true, follow: true };

  return {
    metadataBase: new URL(config.app.url),
    title: {
      default: title,
      template: `%s · ${brand.name}`,
    },
    description,
    keywords: keywordList(brand.keywords),
    openGraph: {
      siteName: brand.name,
      title,
      description,
      type: "website",
      locale: "zh_CN",
      alternateLocale: ["en_US"],
      images: images ? [{ url: images }] : undefined,
    },
    robots,
    alternates: {
      canonical: "/",
      types: {
        "application/rss+xml": `${config.app.url}/feed.xml`,
      },
    },
    formatDetection: { telephone: false, email: false },

    /** PWA */
    manifest: "/manifest.webmanifest",
    applicationName: brand.name,
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" },

    /** icons — self-hosted set from /icons (16 → 512 + SVG + maskable) */
    icons: {
      // SVG 优先 + PNG 兼容链（新品牌 logo-mark 体系，资产源 /logos）
      icon: [
        { url: "/icons/logo-mark.svg", type: "image/svg+xml" },
        { url: "/icons/logo-mark-16.png", sizes: "16x16", type: "image/png" },
        { url: "/icons/logo-mark-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/logo-mark-128.png", sizes: "128x128", type: "image/png" },
        { url: "/icons/logo-mark-256.png", sizes: "256x256", type: "image/png" },
      ],
      shortcut: [{ url: "/icons/logo-mark-64.png", sizes: "64x64" }],
      apple: [{ url: "/icons/logo-mark-256.png", sizes: "180x180", type: "image/png" }],
    },

    /** social cards */
    twitter: {
      card: images ? "summary_large_image" : "summary",
      site,
      title,
      description,
      images: images ? [images] : undefined,
    },
  };
}

/**
 * 子页 metadata 工厂 —— async：读取全站 noindex 开关（私有实例时子页的
 * 显式 robots 也要跟随，root 的 robots 不会自动覆盖显式设置的子页）。
 */
export async function pageMetadata(opts: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
  images?: string[];
  type?: "website" | "article";
  publishedTime?: Date;
  authors?: string[];
  tags?: string[];
}): Promise<Metadata> {
  const brand = await getSiteBrand();
  const siteNoindex = brand.noindex || opts.noindex;
  const url = `${config.app.url}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    robots: siteNoindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      type: opts.type ?? "website",
      images: opts.images?.map((i) => ({ url: i })),
      publishedTime: opts.publishedTime?.toISOString(),
      authors: opts.authors,
      tags: opts.tags,
    },
    twitter: {
      card: opts.images?.length ? "summary_large_image" : "summary",
      title: opts.title,
      description: opts.description,
      images: opts.images,
    },
  };
}

export function personJsonLd(user: Pick<User, "displayName" | "bio" | "username" | "github" | "website" | "avatarPath">) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: user.displayName,
    description: user.bio || undefined,
    url: `${config.app.url}/u/${user.username}`,
    image: user.avatarPath ? `${config.app.url}/api/media/file/${user.avatarPath}` : undefined,
    sameAs: [
      user.github ? `https://github.com/${user.github}` : null,
      user.website ?? null,
    ].filter(Boolean),
  };
}

export function blogPostingJsonLd(opts: {
  post: Pick<Post, "title" | "summary" | "publishedAt" | "updatedAt" | "coverPath" | "content">;
  author: { displayName: string; username: string };
  url: string;
  topics?: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: opts.post.title,
    description: opts.post.summary || undefined,
    datePublished: opts.post.publishedAt?.toISOString(),
    dateModified: opts.post.updatedAt.toISOString(),
    url: opts.url,
    image: opts.post.coverPath ? `${config.app.url}/api/media/file/${opts.post.coverPath}` : undefined,
    author: {
      "@type": "Person",
      name: opts.author.displayName,
      url: `${config.app.url}/u/${opts.author.username}`,
    },
    keywords: opts.topics?.join(", "),
    mainEntityOfPage: opts.url,
    inLanguage: "zh-CN",
  };
}

/**
 * JSON-LD 安全序列化：`</script>`、`<`、U+2028/2029 在 <script> 上下文里
 * 会被浏览器提前终止脚本或注入标签 —— displayName/标题等用户输入经
 * JSON.stringify 后必须再转义（存储型 XSS 防线，2026-09 审计 P0）。
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
