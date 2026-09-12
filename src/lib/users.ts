import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { follows, users, blocks, posts } from "@/db/schema";
import { conflict, forbidden, notFound } from "@/core/errors";
import { slugifyTitle, randomSuffix } from "@/lib/utils";

export const RESERVED_USERNAMES = new Set([
  "www", "app", "api", "admin", "mail", "feed", "blog", "help", "support",
  "about", "login", "register", "signup", "settings", "notifications",
  "messages", "write", "explore", "topics", "archive", "u", "p", "auth",
  "legal", "static", "assets", "cdn", "status", "docs", "rss", "sitemap",
  "root", "administrator", "system", "me", "user", "users", "post", "posts",
]);

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(u) && RESERVED_USERNAMES.has(u) === false;
}

export function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && RESERVED_USERNAMES.has(s) === false;
}

export async function assertUsernameAvailable(username: string) {
  if (!isValidUsername(username)) {
    throw conflict("用户名不可用（仅小写字母、数字、连字符）/ Username unavailable");
  }
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (row) throw conflict("用户名已被占用 / Username taken");
}

export async function uniqueSlug(userId: string, title: string): Promise<string> {
  const base = slugifyTitle(title);
  const taken = new Set(
    (await db.select({ slug: posts.slug }).from(posts).where(eq(posts.authorId, userId))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${randomSuffix(4)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function assertNotBlocked(a: string, b: string) {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
      and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
    ))
    .limit(1);
  if (row) throw forbidden("该操作被阻止 / This interaction is blocked");
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1);
  return Boolean(row);
}

export async function getUserByUsername(username: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, "active")))
    .limit(1);
  if (!user) throw notFound("用户不存在 / User not found");
  return user;
}
