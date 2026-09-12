import { z } from "zod";
import { desc, ilike } from "drizzle-orm";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { withAdmin, ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { conflict } from "@/core/errors";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/keywords?limit=100&q= — keyword blacklist. */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
    const q = (url.searchParams.get("q") ?? "").trim();

    const items = await db
      .select()
      .from(keywords)
      .where(q ? ilike(keywords.word, `%${q}%`) : undefined)
      .orderBy(desc(keywords.createdAt))
      .limit(limit);

    return ok({ items });
  });
}

const postSchema = z.object({
  word: z.string().trim().min(1, "关键词不能为空 / Word required").max(120),
  severity: z.enum(["block", "warn"]),
  category: z.string().trim().max(40).optional(),
});

/** POST /api/admin/keywords — add one keyword. */
export async function POST(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const body = parseOrThrow(postSchema, await jsonBody(req));
    try {
      const [row] = await db
        .insert(keywords)
        .values({
          word: body.word,
          severity: body.severity,
          category: body.category || "general",
        })
        .returning();
      return ok({ item: row });
    } catch {
      throw conflict("关键词已存在 / Keyword already exists");
    }
  });
}
