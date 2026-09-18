import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/db";
import { passkeyCredentials } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { getSetting } from "@/lib/settings";
import { readChallenge, rpFromRequest } from "@/lib/auth/passkey";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  response: z.record(z.string(), z.unknown()),
});


/**
 * POST /api/auth/passkeys/register — 校验注册仪式响应并落库新凭据。
 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    if (!(await getSetting("auth.passkeys"))) {
      throw forbidden("站点未开启通行密钥登录 / Passkey sign-in is not enabled");
    }
    const { name, response } = bodySchema.parse(await jsonBody(req));
    const { rpID, origin } = await rpFromRequest(req);
    const expectedChallenge = await readChallenge(req, "pk_register", auth.user.id);
    if (!expectedChallenge) {
      throw new AppError("注册会话已过期，请重新开始 / Registration session expired", 400, "pk_challenge");
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as never,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      throw new AppError(
        `通行密钥注册校验失败：${err instanceof Error ? err.message : String(err)}`,
        400,
        "pk_verify_failed",
      );
    }
    // v14：凭据信息在 registrationInfo 下（credentialDeviceType/credentialBackedUp 同级）
    const info = verification.registrationInfo;
    if (!info) {
      throw new AppError("认证器未返回注册信息 / No registration info", 400, "pk_no_credential");
    }
    const { credential, credentialDeviceType: deviceType, credentialBackedUp } = info;
    if (!credential) {
      throw new AppError("认证器未返回凭据 / Authenticator returned no credential", 400, "pk_no_credential");
    }

    // simplewebauthn v13+ 的 credential.id 已经是 base64url 字符串
    const credentialId = credential.id;
    const publicKey = Buffer.from(credential.publicKey).toString("base64url");
    const displayName =
      name ||
      (deviceType === "multiDevice" ? "同步通行密钥" : "本机通行密钥");

    await db
      .insert(passkeyCredentials)
      .values({
        userId: auth.user.id,
        name: displayName,
        credentialId,
        publicKey,
        counter: credential.counter,
        transports: (credential.transports ?? []) as string[],
        deviceType,
        backedUp: credentialBackedUp,
      })
      .onConflictDoNothing({ target: passkeyCredentials.credentialId });

    return ok({ ok: true, name: displayName });
  });
}
