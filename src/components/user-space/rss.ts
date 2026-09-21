import "server-only";
import { Feed } from "feed";
import { config } from "@/core/config";
import { absolute, routes } from "@/core/routes";
import type { User } from "@/db/schema";
import type { RssPost } from "./queries";

/** RSS/Atom builders on top of the `feed` package. */

const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

const SITE_LOGO = absolute("/icons/logo-mark-256.png");

function baseFeedOptions() {
  return {
    id: config.app.url,
    link: config.app.url,
    language: "zh",
    copyright: `© ${new Date().getFullYear()} ${config.app.name}`,
    generator: config.app.name,
    image: SITE_LOGO,
    favicon: absolute("/icons/logo-mark.svg"),
    feedLinks: {
      rss: absolute("/feed.xml"),
      atom: absolute("/feed.xml?type=atom"),
    },
  };
}

function addItems(feed: Feed, posts: RssPost[]) {
  for (const p of posts) {
    const link = absolute(routes.post(p.publicId));
    feed.addItem({
      title: p.title,
      id: link,
      link,
      description: p.summary || undefined,
      // 全文 HTML（content:encoded）— 阅读器内直接阅读完整内容
      content: p.contentHtml || p.summary || undefined,
      date: p.publishedAt,
      image: p.coverPath ? absolute(`/api/media/file/${p.coverPath}`) : undefined,
      category: p.topics?.length ? p.topics.map((name) => ({ name })) : undefined,
      author: [{ name: p.authorName, link: absolute(routes.profile(p.authorUsername)) }],
      contributor: [{ name: p.authorName, link: absolute(routes.profile(p.authorUsername)) }],
    });
  }
}

export function buildSiteFeed(siteName: string, siteDescription: string, posts: RssPost[]): Feed {
  const feed = new Feed({
    ...baseFeedOptions(),
    title: siteName,
    description: siteDescription,
    author: { name: siteName, link: config.app.url },
  });
  addItems(feed, posts);
  return feed;
}

export function buildUserFeed(user: User, posts: RssPost[]): Feed {
  const link = absolute(routes.profile(user.username));
  const avatar = user.avatarPath ? absolute(`/api/media/file/${user.avatarPath}`) : SITE_LOGO;
  const feed = new Feed({
    ...baseFeedOptions(),
    title: `${user.displayName} · ${config.app.name}`,
    description: user.bio || `${user.displayName} 的文章与动态`,
    id: link,
    link,
    image: avatar,
    author: { name: user.displayName, link },
  });
  feed.options.feedLinks = {
    rss: absolute(routes.userRss(user.username)),
    atom: absolute(`${routes.userRss(user.username)}?type=atom`),
  };
  addItems(feed, posts);
  return feed;
}

export function feedResponse(feed: Feed, type: string | null): Response {
  const xml = type === "atom" ? feed.atom1() : feed.rss2();
  return new Response(xml, {
    headers: {
      "Content-Type": RSS_CONTENT_TYPE,
      "Cache-Control": "public, max-age=600",
    },
  });
}
