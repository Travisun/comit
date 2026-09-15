import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { checkUsernameAvailable, USERNAME_COOLDOWN_DAYS, USERNAME_MAX, USERNAME_MIN } from "@/lib/users";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function daysSince(at: Date | null): number {
  if (!at) return Number.POSITIVE_INFINITY;
  return (Date.now() - at.getTime()) / 86_400_000;
}

/**
 * GET /api/me/username            — 当前用户名 + 冷却策略
 * GET /api/me/username?u=<input>  — 实时可用性检查（格式/保留字/占用）
 */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "请先登录 / Sign in required" }, { status: 401 });

    const check = new URL(req.url).searchParams.get("u");
    if (check !== null) {
      const result = await checkUsernameAvailable(check);
      // 与自己当前用户名相同视为可用（即「未修改」）
      const same = check.trim().toLowerCase() === user.username;
      return ok({ ...result, ok: result.ok || same });
    }

    const days = daysSince(user.usernameUpdatedAt);
    return ok({
      username: user.username,
      min: USERNAME_MIN,
      max: USERNAME_MAX,
      cooldownDays: USERNAME_COOLDOWN_DAYS,
      daysUntilChangeAllowed: Number.isFinite(days)
        ? Math.max(0, Math.ceil(USERNAME_COOLDOWN_DAYS - days))
        : 0,
    });
  });
}

const putSchema = z.object({
  username: z.string().trim().min(1).max(USERNAME_MAX + 1),
});

/** PUT /api/me/username — 修改用户名（每 30 天一次）。 */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const { username } = parseOrThrow(putSchema, await req.json().catch(() => null));

    const normalized = username.toLowerCase();
    if (normalized === auth.user.username) return ok({ username: normalized });

    const check = await checkUsernameAvailable(username);
    if (!check.ok) throw forbidden(check.reason ?? "该用户名不可用 / Username unavailable");

    const days = daysSince(auth.user.usernameUpdatedAt);
    if (days < USERNAME_COOLDOWN_DAYS) {
      const wait = Math.ceil(USERNAME_COOLDOWN_DAYS - days);
      throw forbidden(
        `用户名每 ${USERNAME_COOLDOWN_DAYS} 天仅可修改一次，还需等待 ${wait} 天 / Username can be changed once every ${USERNAME_COOLDOWN_DAYS} days`,
      );
    }

    await db
      .update(users)
      .set({ username: normalized, usernameUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return ok({ username: normalized });
  });
}
