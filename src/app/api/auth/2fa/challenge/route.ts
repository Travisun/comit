import { z } from "zod";
import { AppError, unauthorized } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getAuth, setSessionPending2fa } from "@/lib/auth/session";
import { hasConfirmedTotp, useRecoveryCode, verifyTotpCode } from "@/lib/auth/totp";
import { parseJsonBody } from "../../_lib/validate";

export const runtime = "nodejs";

const schema = z
  .object({
    code: z.string().trim().max(10).optional(),
    recoveryCode: z.string().trim().max(32).optional(),
  })
  .refine((d) => Boolean(d.code || d.recoveryCode), {
    message: "请输入验证码或恢复代码 / Enter a code or a recovery code",
  });

/** Solve the mandatory 2FA challenge with a TOTP code or a recovery code. */
export async function POST(req: Request) {
  return withApi(req, async () => {
    rateLimit(`2fa-challenge:${clientIp(req)}`, 10, 60_000);
    const auth = await getAuth();
    if (!auth) throw unauthorized("请先登录 / Please sign in");
    const body = await parseJsonBody(req, schema);

    let passed = false;
    if (body.code) {
      // recovery codes are only valid alongside a confirmed TOTP
      if (!(await hasConfirmedTotp(auth.user.id))) {
        throw new AppError("请先绑定验证器 / Finish authenticator setup first", 400, "totp_unconfirmed");
      }
      passed = (await verifyTotpCode(auth.user.id, body.code)).ok;
    } else if (body.recoveryCode) {
      passed = await useRecoveryCode(auth.user.id, body.recoveryCode);
    }
    if (!passed) {
      throw new AppError("验证码错误，请重试 / Invalid code, try again", 400, "bad_totp");
    }

    await setSessionPending2fa(auth.sessionId, false);
    return ok({ ok: true });
  });
}
