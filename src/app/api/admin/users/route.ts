import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { maskEmail, pagination } from "@/app/api/admin/_shared";
import { escapeLikePattern } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users?q=&filter=all|active|banned|admin&limit=25&offset=
 * Searchable user list with post counts and ban state.
 * `isBanned` is computed at read time: suspended AND (no bannedUntil or still
 * in the future). A suspended user whose bannedUntil has passed is "expired"
 * (awaiting auto-unban at next login or a manual unban).
 */
export async function GET(req: Request) {
  return withPermission(req, "admin.users", async () => {
    const url = new URL(req.url);
    const { limit, offset } = pagination(url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const filter = url.searchParams.get("filter") ?? "all";

    // the DB enum (user/admin) has no `editor` role yet — the filter matches
    // nothing instead of crashing on an invalid enum input.
    if (filter === "editor") return ok({ items: [], total: 0 });

    const conds: SQL[] = [];
    if (q) {
      const like = `%${escapeLikePattern(q)}%`;
      const cond = or(ilike(users.username, like), ilike(users.displayName, like), ilike(users.email, like));
      if (cond) conds.push(cond);
    }
    if (filter === "active") conds.push(eq(users.status, "active"));
    if (filter === "banned") conds.push(eq(users.status, "suspended"));
    if (filter === "admin") conds.push(eq(users.role, "admin"));
    const where = conds.length ? and(...conds) : undefined;

    const postCountSql = sql<number>`(select count(*) from ${posts} where ${posts.authorId} = ${users.id})`;

    const [rows, [{ n: total }]] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarPath: users.avatarPath,
          email: users.email,
          role: users.role,
          status: users.status,
          tier: users.tier,
          verified: users.verified,
          bannedUntil: users.bannedUntil,
          banReason: users.banReason,
          postCount: postCountSql.mapWith(Number),
          createdAt: users.createdAt,
        })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(users).where(where),
    ]);

    const now = Date.now();
    const items = rows.map(({ email, bannedUntil, ...rest }) => ({
      ...rest,
      email: maskEmail(email),
      bannedUntil: bannedUntil?.toISOString() ?? null,
      isBanned: rest.status === "suspended" && (!bannedUntil || bannedUntil.getTime() > now),
    }));

    return ok({ items, total });
  });
}
