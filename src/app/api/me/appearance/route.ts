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

    if (body.appearance || body.widgets) {
      const valid = new Set(WIDGET_CATALOG.map((w) => w.id));
      const widgets = body.widgets
        ? [...new Set(body.widgets)].filter((id) => valid.has(id))
        : undefined;

      // appearance / widgets 同在 users 行的 jsonb 列，读-改-写并发保存会互相
      // 覆盖。事务 + FOR UPDATE 行锁串行化；锁内重读最新值（auth.user.appearance
      // 只是会话快照，可能滞后），两列合一次 UPDATE 写回。
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ appearance: users.appearance })
          .from(users)
          .where(eq(users.id, auth.user.id))
          .limit(1)
          .for("update");

        let appearance: typeof users.$inferSelect["appearance"] | undefined;
        if (body.appearance) {
          const next = { ...(row?.appearance ?? {}) };
          for (const [k, v] of Object.entries(body.appearance)) {
            (next as Record<string, unknown>)[k] = v ?? null;
          }
          appearance = next;
        }

        await tx
          .update(users)
          .set({ appearance, widgets, updatedAt: new Date() })
          .where(eq(users.id, auth.user.id));
      });
    }

    return ok();
  });
}
