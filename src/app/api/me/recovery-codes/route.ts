import { AppError, ok, withUser } from "@/lib/http";
import { hasConfirmedTotp, regenerateRecoveryCodes } from "@/lib/auth/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/me/recovery-codes — regenerate 2FA recovery codes (shown once). */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    if (!(await hasConfirmedTotp(auth.user.id))) {
      throw new AppError("两步验证未启用 / Two-factor auth is not enabled", 400, "no_totp");
    }
    const codes = await regenerateRecoveryCodes(auth.user.id);
    return ok({ codes });
  });
}
