import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { notFound } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { coerceExtSettings } from "@/core/capabilities/manifest";
import { getExtensionManifest } from "@/extensions/_boot/manifests";

type Ctx = { params: Promise<{ ext: string }> };

/** GET /api/me/ext/[ext]/settings — 当前用户的扩展设置（经 manifest 收敛）。 */
export async function GET(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { ext } = await ctx.params;
    const manifest = getExtensionManifest(ext);
    if (!manifest) throw notFound();

    const [row] = await db
      .select({ extSettings: users.extSettings })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);
    const raw = (row?.extSettings as Record<string, Record<string, unknown>> | null)?.[ext];
    return ok({ settings: coerceExtSettings(manifest, raw) });
  });
}

/** PUT /api/me/ext/[ext]/settings — 保存当前用户的扩展设置。 */
export async function PUT(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { ext } = await ctx.params;
    const manifest = getExtensionManifest(ext);
    if (!manifest) throw notFound();

    const body = await jsonBody<Record<string, unknown>>(req);
    const settings = coerceExtSettings(manifest, body);

    const [row] = await db
      .select({ extSettings: users.extSettings })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);
    const merged = {
      ...((row?.extSettings as object) ?? {}),
      [ext]: settings,
    };
    await db.update(users).set({ extSettings: merged }).where(eq(users.id, auth.user.id));
    return ok({ settings });
  });
}
