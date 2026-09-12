import { z } from "zod";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { withAdmin, ok, jsonBody } from "@/lib/http"
import { withPermission } from "@/lib/permissions";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  words: z
    .array(z.string().trim().min(1).max(120))
    .min(1, "至少一个关键词 / At least one word")
    .max(500),
  severity: z.enum(["block", "warn"]),
  category: z.string().trim().max(40).optional(),
});

/** POST /api/admin/keywords/bulk — import many keywords at once (duplicates skipped). */
export async function POST(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    // dedupe within the payload, then let the DB unique index skip existing rows
    const words = [...new Set(body.words.map((w) => w.trim()).filter(Boolean))];
    if (!words.length) return ok({ inserted: 0, skipped: 0 });

    const inserted = await db
      .insert(keywords)
      .values(
        words.map((word) => ({
          word,
          severity: body.severity,
          category: body.category || "general",
        })),
      )
      .onConflictDoNothing({ target: keywords.word })
      .returning({ id: keywords.id });

    return ok({ inserted: inserted.length, skipped: words.length - inserted.length });
  });
}
