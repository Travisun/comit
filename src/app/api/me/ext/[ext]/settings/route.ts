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

    // users.extSettings 是整段 jsonb 的读-改-写：并发保存两个不同扩展的设置
    // 会互相覆盖。事务 + FOR UPDATE 行锁串行化同一用户行的合并，锁内重读
    // 拿到最新值再合并写回。
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ extSettings: users.extSettings })
        .from(users)
        .where(eq(users.id, auth.user.id))
        .limit(1)
        .for("update");
      const merged = {
        ...((row?.extSettings as Record<string, Record<string, unknown>> | null) ?? {}),
        [ext]: settings,
      };
      await tx.update(users).set({ extSettings: merged }).where(eq(users.id, auth.user.id));
    });
    return ok({ settings });
  });
}
