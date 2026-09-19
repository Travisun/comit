import QRCode from "qrcode";
import { forbidden, unauthorized } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getAuth } from "@/lib/auth/session";
import { createTotpSetup, hasConfirmedTotp } from "@/lib/auth/totp";

export const runtime = "nodejs";

/** Begin (or restart) TOTP enrollment. Allowed while pending2fa. */
export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.twofa", clientIp(req));
    const auth = await getAuth();
    if (!auth) throw unauthorized("请先登录 / Please sign in");

    if (await hasConfirmedTotp(auth.user.id)) {
      throw forbidden("两步验证已绑定 / Two-factor authentication is already enabled");
    }
    // ?force=1：用户主动要求换码（扫错 App/换手机等）——重新生成 pending 密钥
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { secret, uri } = await createTotpSetup(
      { id: auth.user.id, email: auth.user.email },
      { force },
    );
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    return ok({ uri, qrDataUrl, secret });
  });
}
