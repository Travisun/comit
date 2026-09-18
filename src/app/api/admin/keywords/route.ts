import { z } from "zod";
import { desc, ilike } from "drizzle-orm";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { pagination } from "@/app/api/admin/_shared";
import { conflict } from "@/core/errors";
import { parseOrThrow } from "@/app/api/admin/_shared";
import { escapeLikePattern } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/keywords?limit=100&q= — keyword blacklist. */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const { limit } = pagination(url, { defaultLimit: 100, maxLimit: 200 });
    const q = (url.searchParams.get("q") ?? "").trim();

    const items = await db
      .select()
      .from(keywords)
      .where(q ? ilike(keywords.word, `%${escapeLikePattern(q)}%`) : undefined)
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

/**
 * Postgres unique_violation (23505) — drizzle 0.4x 会把驱动错误包在
 * DrizzleQueryError.cause 里，沿 cause 链向上找 pg 错误码。
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 4; depth++) {
    if ((cur as Error & { code?: string }).code === "23505") return true;
    cur = (cur as Error).cause;
  }
  return false;
}

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
    } catch (err) {
      // 只有唯一键冲突才映射 409；其余错误 rethrow 走统一 500 管线
      if (!isUniqueViolation(err)) throw err;
      throw conflict("关键词已存在 / Keyword already exists");
    }
  });
}
