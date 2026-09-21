import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { collections } from "@/db/schema";
import { conflict } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { withAdvisoryLock } from "@/lib/pg-lock";
import { parseWith, normalizeSlug } from "../_shared";

/**
 * GET  /api/posts/collections — the current user's collections.
 * POST /api/posts/collections — { name } create (or return existing, per-user
 *                               slug unique upsert) → collection row.
 */
export async function GET(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const items = await db
      .select()
      .from(collections)
      .where(eq(collections.userId, auth.user.id))
      .orderBy(desc(collections.createdAt));
    return ok({ items });
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

/** 每用户合集上限：无上限时脚本可用一次性名字（符号名走随机 slug 分支）无限建行。 */
const MAX_COLLECTIONS_PER_USER = 100;

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const { name, description } = parseWith(createSchema, await jsonBody(req));
    const slug = normalizeSlug(name).slice(0, 120);

    // 「查在不在 → 数数量 → 插」不是原子序列：cluster 多 worker 下并发请求可一起
    // 越过上限（也一起撞上 uniqueIndex 而返回 500）。同一把用户级 advisory 锁把
    // 本用户的所有合集写操作串起来，锁内读到的必然包含已提交的行。
    const row = await withAdvisoryLock(`collection:${auth.user.id}`, async (tx) => {
      const [existing] = await tx
        .select()
        .from(collections)
        .where(and(eq(collections.userId, auth.user.id), eq(collections.slug, slug)))
        .limit(1);
      if (existing) return existing; // 幂等：同 slug（含大小写/符号归一）返回既有合集

      const [{ n }] = await tx
        .select({ n: count() })
        .from(collections)
        .where(eq(collections.userId, auth.user.id));
      if (n >= MAX_COLLECTIONS_PER_USER) {
        throw conflict(`合集数量已达上限（${MAX_COLLECTIONS_PER_USER}）/ Collection limit reached`);
      }

      const [created] = await tx
        .insert(collections)
        .values({
          userId: auth.user.id,
          slug,
          name,
          description: description ?? "",
        })
        .returning();
      return created;
    });
    return ok(row);
  });
}
