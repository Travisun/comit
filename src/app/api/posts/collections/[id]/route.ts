import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { collections } from "@/db/schema";
import { notFound } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { withAdvisoryLock } from "@/lib/pg-lock";
import { parseWith, normalizeSlug } from "../../_shared";

/**
 * PATCH  /api/posts/collections/[id] — { name } rename (slug re-derived;
 *        conflicts with another collection fall back to the existing slug).
 * DELETE /api/posts/collections/[id] — delete; posts fall back to 未分类
 *        (posts.collection_id is ON DELETE SET NULL).
 */

const renameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return withUser(req, async (auth) => {
    const [row] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, auth.user.id)))
      .limit(1);
    if (!row) throw notFound("合集不存在 / Collection not found");

    const { name } = parseWith(renameSchema, await jsonBody(req));

    // re-derive the slug; on a unique conflict keep the old slug (name is
    // what users see — the slug only needs to stay stable and unique)
    const slug = normalizeSlug(name).slice(0, 120) || row.slug;
    // 与创建共用同一把用户级锁：改名是「查冲突 → 写」序列，并发改名可一起通过
    // 冲突检查，再由 unique 索引把其中一个打成 500（或写入非预期 slug）。
    const updated = await withAdvisoryLock(`collection:${auth.user.id}`, async (tx) => {
      const [clash] = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.userId, auth.user.id), eq(collections.slug, slug)))
        .limit(1);
      const nextSlug = clash && clash.id !== row.id ? row.slug : slug;
      const [r] = await tx
        .update(collections)
        .set({ name, slug: nextSlug })
        .where(and(eq(collections.id, row.id), eq(collections.userId, auth.user.id)))
        .returning();
      if (!r) throw notFound("合集不存在 / Collection not found");
      return r;
    });
    return ok(updated);
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return withUser(req, async (auth) => {
    const [row] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, auth.user.id)))
      .limit(1);
    if (!row) throw notFound("合集不存在 / Collection not found");
    await db.delete(collections).where(eq(collections.id, row.id));
    return ok({ id: row.id });
  });
}
