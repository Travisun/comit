import { and, count, desc, eq, ilike, isNotNull, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { pagination } from "@/app/api/admin/_shared";
import { escapeLikePattern } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/invites?filter=used|unused|all — site-wide invite overview
 * with creator ("邀请人") and consumer ("使用者") joined, plus usage stats.
 */
export async function GET(req: Request) {
  return withPermission(req, "admin.users", async () => {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") ?? "all";
    const q = (url.searchParams.get("q") ?? "").trim();
    // 统一分页入口（浮点/NaN/越界防御收敛在 _shared.pagination）
    const { limit, offset } = pagination(url, { defaultLimit: 100, maxLimit: 200 });

    const creator = alias(users, "creator");
    const consumer = alias(users, "consumer");

    const conds: SQL[] = [];
    if (filter === "used") conds.push(isNotNull(invites.usedAt));
    if (filter === "unused") conds.push(isNull(invites.usedAt));
    if (q) conds.push(ilike(invites.code, `%${escapeLikePattern(q)}%`));
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ n: total }], [usedStat]] = await Promise.all([
      db
        .select({
          id: invites.id,
          code: invites.code,
          createdAt: invites.createdAt,
          usedAt: invites.usedAt,
          createdBy: invites.createdBy,
          creatorUsername: creator.username,
          creatorDisplayName: creator.displayName,
          usedBy: invites.usedBy,
          usedByUsername: consumer.username,
          usedByDisplayName: consumer.displayName,
        })
        .from(invites)
        .innerJoin(creator, eq(creator.id, invites.createdBy))
        .leftJoin(consumer, eq(consumer.id, invites.usedBy))
        .where(where)
        .orderBy(desc(invites.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(invites).where(where),
      db.select({ n: count() }).from(invites).where(isNotNull(invites.usedAt)),
    ]);

    return ok({
      items: rows,
      total,
      stats: { used: usedStat.n, unused: total - usedStat.n },
    });
  });
}
