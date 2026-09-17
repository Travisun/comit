import "server-only";
import { Feed } from "feed";
import { config } from "@/core/config";
import { absolute, routes } from "@/core/routes";
import type { User } from "@/db/schema";
import type { RssPost } from "./queries";

/** RSS/Atom builders on top of the `feed` package. */

const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

function baseFeedOptions() {
  return {
    id: config.app.url,
    link: config.app.url,
    language: "zh",
    copyright: `© ${new Date().getFullYear()} ${config.app.name}`,
    generator: config.app.name,
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
      content: p.summary || undefined,
      date: p.publishedAt,
      image: p.coverPath ? absolute(`/api/media/file/${p.coverPath}`) : undefined,
      author: [{ name: p.authorName, link: absolute(`/u/${p.authorUsername}`) }],
      contributor: [{ name: p.authorName, link: absolute(`/u/${p.authorUsername}`) }],
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
  const link = absolute(`/u/${user.username}`);
  const feed = new Feed({
    ...baseFeedOptions(),
    title: `${user.displayName} · ${config.app.name}`,
    description: user.bio || `${user.displayName} 的文章`,
    id: link,
    link,
    author: { name: user.displayName, link },
  });
  feed.options.feedLinks = {
    rss: absolute(`/u/${user.username}/feed.xml`),
    atom: absolute(`/u/${user.username}/feed.xml?type=atom`),
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
