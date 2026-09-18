import { z } from "zod";
import { AppError, unauthorized } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getAuth, setSessionPending2fa } from "@/lib/auth/session";
import { verifyTotpCode } from "@/lib/auth/totp";
import { parseJsonBody } from "../../_lib/validate";

export const runtime = "nodejs";

const schema = z.object({
  code: z.string().trim().min(6, "请输入 6 位验证码 / Enter the 6-digit code").max(10),
});

/** Confirm TOTP enrollment; activates the account's 2FA and clears pending. */
export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.twofa", clientIp(req));
    const auth = await getAuth();
    if (!auth) throw unauthorized("请先登录 / Please sign in");
    const { code } = await parseJsonBody(req, schema);

    const result = await verifyTotpCode(auth.user.id, code, { confirm: true });
    if (!result.ok || !result.recoveryCodes) {
      throw new AppError("验证码错误，请重试 / Invalid code, try again", 400, "bad_totp");
    }
    await setSessionPending2fa(auth.sessionId, false);
    // 未完成注册引导的用户先进 onboarding
    const redirect = auth.user.onboardedAt ? undefined : "/onboarding";
    return ok({ ok: true, recoveryCodes: result.recoveryCodes, redirect });
  });
}
