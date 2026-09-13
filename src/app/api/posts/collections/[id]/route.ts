import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { collections } from "@/db/schema";
import { jsonBody, ok, withUser } from "@/lib/http";
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
    if (!row) return ok(null);

    const { name } = parseWith(renameSchema, await jsonBody(req));

    // re-derive the slug; on a unique conflict keep the old slug (name is
    // what users see — the slug only needs to stay stable and unique)
    const slug = normalizeSlug(name).slice(0, 120) || row.slug;
    const [conflict] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.userId, row.userId), eq(collections.slug, slug)))
      .limit(1);
    const nextSlug = conflict && conflict.id !== row.id ? row.slug : slug;

    const [updated] = await db
      .update(collections)
      .set({ name, slug: nextSlug })
      .where(eq(collections.id, row.id))
      .returning();
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
    if (!row) return ok(null);
    await db.delete(collections).where(eq(collections.id, row.id));
    return ok({ id: row.id });
  });
}
