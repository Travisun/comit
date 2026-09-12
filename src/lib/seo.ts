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
      types: { "application/rss+xml": `${config.app.url}/feed.xml` },
    },
    formatDetection: { telephone: false, email: false },
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
