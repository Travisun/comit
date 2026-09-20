import { z } from "zod";
import { AppError, unauthorized } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getAuth, setSessionPending2fa } from "@/lib/auth/session";
import { consumeRecoveryCode, hasConfirmedTotp, verifyTotpCode } from "@/lib/auth/totp";
import { emit } from "@/core/events";
import { routes } from "@/core/routes";
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
    await rateLimitBucket("auth.twofa", clientIp(req));
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
      passed = await consumeRecoveryCode(auth.user.id, body.recoveryCode);
    }
    if (!passed) {
      throw new AppError("验证码错误，请重试 / Invalid code, try again", 400, "bad_totp");
    }

    await setSessionPending2fa(auth.sessionId, false);
    // 登录真正完成的时刻（2FA 通过）；ip 从会话创建时已记录
    await emit("auth:login", { userId: auth.user.id });

    // 未验证邮箱先过验证关卡；未完成注册引导的再进 onboarding
    const redirect = !auth.user.emailVerifiedAt
      ? routes.verifyEmail
      : auth.user.onboardedAt
        ? undefined
        : "/onboarding";
    return ok({ ok: true, redirect });
  });
}
