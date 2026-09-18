import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { notFound } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { coerceExtSettings } from "@/core/capabilities/manifest";
import { getExtensionManifest } from "@/extensions/_boot/manifests";

type Ctx = { params: Promise<{ ext: string }> };

/** GET /api/me/ext/[ext]/settings — 当前用户的扩展设置（经 manifest 收敛）。 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { ext } = await ctx.params;
    const manifest = getExtensionManifest(ext);
    // 仅注册了前台设置项的扩展可读写（纯后台能力扩展无用户级设置面）
    if (!manifest || (manifest.settingsFields?.length ?? 0) === 0) throw notFound();

    const [row] = await db
      .select({ extSettings: users.extSettings })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);
    const raw = (row?.extSettings as Record<string, Record<string, unknown>> | null)?.[ext];
    return ok({ settings: coerceExtSettings(manifest, raw) });
  });
}

/** PUT /api/me/ext/[ext]/settings — 保存当前用户的扩展设置。
 *
 * 权限契约（用户级 ⇄ 管理员级互不越界）：
 *  - 本端点仅写**当前用户自己的** users.extSettings[ext]（withUser + 行级
 *    锁合并），任何路径参数都无法触达他人数据或全局 settings 表；
 *  - 入参经 coerceExtSettings 按 manifest.settingsFields 白名单收敛：未声明
 *    键丢弃、类型不符回落默认、select/radio 只接受已注册选项、字符串按
 *    maxLength 截断 —— 篡改/注入面在服务端收口；
 *  - 扩展启停与全局参数（settings 表 ext.* 键）只能经 /api/admin/settings
 *    （withAdmin）修改，本端点不可达。
 */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return withUser(req, async (auth) => {
    const { ext } = await ctx.params;
    const manifest = getExtensionManifest(ext);
    if (!manifest || (manifest.settingsFields?.length ?? 0) === 0) throw notFound();

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
