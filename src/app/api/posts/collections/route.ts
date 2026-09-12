import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { collections } from "@/db/schema";
import { jsonBody, ok, withUser } from "@/lib/http";
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

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const { name, description } = parseWith(createSchema, await jsonBody(req));
    const slug = normalizeSlug(name).slice(0, 120);

    await db
      .insert(collections)
      .values({
        userId: auth.user.id,
        slug,
        name,
        description: description ?? "",
      })
      .onConflictDoNothing({ target: [collections.userId, collections.slug] });

    const [row] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.userId, auth.user.id), eq(collections.slug, slug)))
      .limit(1);
    return ok(row);
  });
}
