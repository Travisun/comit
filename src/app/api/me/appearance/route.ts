import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, withUser } from "@/lib/http";
import { parseOrThrow } from "../_shared";
import { WIDGET_CATALOG } from "@/components/user-space/widget-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appearanceSchema = z.object({
  homeBg: z.string().trim().max(300).nullable().optional(),
  postBg: z.string().trim().max(300).nullable().optional(),
  accent: z.string().trim().max(100).nullable().optional(),
  fontFamily: z.enum(["system", "serif", "mono"]).nullable().optional(),
  fontSize: z.enum(["sm", "md", "lg"]).nullable().optional(),
});

const bodySchema = z.object({
  appearance: appearanceSchema.optional(),
  widgets: z.array(z.string()).optional(),
});

/** PUT /api/me/appearance — page background/accent/font + sidebar widget selection. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(bodySchema, await req.json().catch(() => null));

    if (body.appearance) {
      const current = auth.user.appearance ?? {};
      const next = { ...current };
      for (const [k, v] of Object.entries(body.appearance)) {
        (next as Record<string, unknown>)[k] = v ?? null;
      }
      await db
        .update(users)
        .set({ appearance: next, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));
    }

    if (body.widgets) {
      const valid = new Set(WIDGET_CATALOG.map((w) => w.id));
      const widgets = [...new Set(body.widgets)].filter((id) => valid.has(id));
      await db
        .update(users)
        .set({ widgets, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));
    }

    return ok();
  });
}
