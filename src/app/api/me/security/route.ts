import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, totpSecrets } from "@/db/schema";
import { unauthorized } from "@/core/errors";
import { ok, withApi } from "@/lib/http";
import { getAuth, getCurrentUser } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/security — 2FA state, remaining recovery codes, active sessions. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();
    const auth = await getAuth();

    const twoFactorConfirmed = await hasConfirmedTotp(user.id);
    const [totp] = await db
      .select({ recoveryCodes: totpSecrets.recoveryCodes })
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, user.id))
      .limit(1);

    const rows = await db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt));

    return ok({
      twoFactorConfirmed,
      recoveryCodesCount: totp?.recoveryCodes.length ?? 0,
      hasPassword: Boolean(user.passwordHash),
      sessions: rows.map((s) => ({
        ...s,
        current: auth?.sessionId === s.id,
      })),
    });
  });
}
