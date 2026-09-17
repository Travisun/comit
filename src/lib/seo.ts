import type { Metadata } from "next";
import { config } from "@/core/config";
import type { User, Post } from "@/db/schema";

/** SEO / GEO metadata helpers — one place for titles, canonicals, OG, robots. */

export function siteMetadata(): Metadata {
  return {
    metadataBase: new URL(config.app.url),
    title: {
      default: "comit.sh — Commit your ideas.",
      template: `%s · ${config.app.name}`,
    },
    description:
      "为极客、设计师、科学家与领域学子打造的个人主页社交网络：科研日志、研究发布与项目动态，为每一次提交留下主页。",
    openGraph: {
      siteName: config.app.name,
      title: "comit.sh — Commit your ideas.",
      description:
        "为极客、设计师、科学家与领域学子打造的个人主页社交网络：科研日志、研究发布与项目动态，为每一次提交留下主页。",
      type: "website",
      locale: "zh_CN",
      alternateLocale: ["en_US"],
    },
    robots: { index: true, follow: true },
    alternates: {
      canonical: "/",
      types: {
        "application/rss+xml": `${config.app.url}/feed.xml`,
      },
    },
    formatDetection: { telephone: false, email: false },

    /** PWA */
    manifest: "/manifest.webmanifest",
    applicationName: config.app.name,
    appleWebApp: { capable: true, title: config.app.name, statusBarStyle: "default" },

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
      card: "summary",
      title: "comit.sh — Commit your ideas.",
      description:
        "为极客、设计师、科学家与领域学子打造的个人主页社交网络：科研日志、研究发布与项目动态。",
    },
  };
}

export function pageMetadata(opts: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
  images?: string[];
  type?: "website" | "article";
  publishedTime?: Date;
  authors?: string[];
  tags?: string[];
}): Metadata {
  const url = `${config.app.url}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    robots: opts.noindex ? { index: false, follow: false } : { index: true, follow: true },
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
  post: Pick<Post, "title" | "summary" | "slug" | "publishedAt" | "updatedAt" | "coverPath" | "content">;
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
