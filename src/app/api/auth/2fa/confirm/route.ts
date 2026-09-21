import { z } from "zod";
import { AppError, unauthorized } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getAuth, setSessionPending2fa } from "@/lib/auth/session";
import { verifyTotpCode } from "@/lib/auth/totp";
import { emit } from "@/core/events";
import { routes } from "@/core/routes";
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
    // 与 challenge 同口径的账户级桶：confirm 成功同样会 setSessionPending2fa(false)
    // 把半认证会话升格为完整会话（等同登录完成），只有 IP 桶时代理池可换 IP
    // 对单一账户无限爆破 6 位 TOTP；补齐后单账户 5 分钟窗口最多 10 次。
    await rateLimitBucket("auth.twofa.account", auth.user.id);
    const { code } = await parseJsonBody(req, schema);

    const result = await verifyTotpCode(auth.user.id, code, { confirm: true });
    if (!result.ok || !result.recoveryCodes) {
      throw new AppError("验证码错误，请重试 / Invalid code, try again", 400, "bad_totp");
    }
    await setSessionPending2fa(auth.sessionId, false);
    // 登录真正完成的时刻（首次 2FA 设置成功 = 首次登录完成）；触发欢迎通知等
    await emit("auth:login", { userId: auth.user.id });
    // 未验证邮箱先过验证关卡；未完成注册引导的再进 onboarding
    const redirect = !auth.user.emailVerifiedAt
      ? routes.verifyEmail
      : auth.user.onboardedAt
        ? undefined
        : "/onboarding";
    return ok({ ok: true, recoveryCodes: result.recoveryCodes, redirect });
  });
}
