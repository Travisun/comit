import type { MetadataRoute } from "next";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { posts, topics, users } from "@/db/schema";
import { config } from "@/core/config";
import { routes } from "@/core/routes";

/** sitemap.xml — static pages + users + published public articles + topics. */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.app.url.replace(/\/$/, "");
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}${routes.home}`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}${routes.feed}`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}${routes.explore}`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}${routes.legal.terms}`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}${routes.legal.privacy}`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/legal/copyright`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const [userRows, postRows, topicRows] = await Promise.all([
      db
        .select({ username: users.username, updatedAt: users.updatedAt })
        .from(users)
        .where(eq(users.status, "active")),
      db
        .select({
          username: users.username,
          slug: posts.slug,
          updatedAt: posts.updatedAt,
          publishedAt: posts.publishedAt,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(and(eq(posts.status, "published"), eq(posts.visibility, "public")))
        .orderBy(desc(posts.publishedAt))
        .limit(5000),
      db.select({ slug: topics.slug }).from(topics),
    ]);

    return [
      ...staticEntries,
      ...userRows.map((u) => ({
        url: `${base}${routes.profile(u.username)}`,
        lastModified: u.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
      ...postRows
        .filter((p): p is typeof p & { slug: string } => Boolean(p.slug))
        .map((p) => ({
          url: `${base}${routes.post(p.username, p.slug)}`,
          lastModified: p.updatedAt,
          changeFrequency: "weekly" as const,
          priority: 0.8,
        })),
      ...topicRows.map((t) => ({
        url: `${base}${routes.topic(t.slug)}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.5,
      })),
    ];
  } catch (err) {
    console.error("[sitemap] db unavailable:", (err as Error).message);
    return staticEntries;
  }
}
