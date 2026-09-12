import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { notFound } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { parseWith } from "@/app/api/posts/_shared";

/**
 * POST /api/media/alt — { id, alt } update the accessibility description of
 * one of the current user's media items.
 */
const altSchema = z.object({
  id: z.uuid(),
  alt: z.string().trim().max(300),
});

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const { id, alt } = parseWith(altSchema, await jsonBody(req));
    const [row] = await db
      .update(media)
      .set({ alt })
      .where(and(eq(media.id, id), eq(media.userId, auth.user.id)))
      .returning();
    if (!row) throw notFound("媒体不存在 / Media not found");
    return ok(row);
  });
}
