import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { passkeyCredentials, users } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { jsonBody, ok, withApi } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getSetting } from "@/lib/settings";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { readChallenge, rpFromRequest } from "@/lib/auth/passkey";

export const runtime = "nodejs";

const bodySchema = z.object({
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null),
});

const BAD_CREDENTIALS = "通行密钥验证失败 / Passkey verification failed";

/**
 * POST /api/auth/passkeys/login — 校验可发现凭据登录仪式，建立会话。
 * 2FA 语义与密码登录完全一致：已启用 TOTP 的用户仍需完成挑战
 * （pending2fa 会话 → /auth/2fa/challenge）。
 */
export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.passkey", clientIp(req));
    if (!(await getSetting("auth.passkeys"))) {
      throw forbidden("站点未开启通行密钥登录 / Passkey sign-in is not enabled");
    }
    const { response } = bodySchema.parse(await jsonBody(req));
    const { rpID, origin } = await rpFromRequest(req);
    const expectedChallenge = await readChallenge(req, "pk_login", null);
    if (!expectedChallenge) {
      throw new AppError("登录会话已过期，请重试 / Login session expired", 400, "pk_challenge");
    }

    const credentialId = response.id;
    const [row] = await db
      .select({ pk: passkeyCredentials, user: users })
      .from(passkeyCredentials)
      .innerJoin(users, eq(users.id, passkeyCredentials.userId))
      .where(and(eq(passkeyCredentials.credentialId, credentialId)))
      .limit(1);
    if (!row) throw new AppError(BAD_CREDENTIALS, 401, "bad_credentials");
    if (row.user.status === "deleted" || row.user.deletedAt) {
      throw new AppError(BAD_CREDENTIALS, 401, "bad_credentials");
    }
    if (row.user.status === "suspended") {
      throw forbidden("账号已被封禁 / Account is banned");
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: row.pk.credentialId,
          publicKey: new Uint8Array(Buffer.from(row.pk.publicKey, "base64url")),
          counter: row.pk.counter,
          transports: row.pk.transports as never,
        },
      });
    } catch (err) {
      throw new AppError(
        `通行密钥验证失败：${err instanceof Error ? err.message : String(err)}`,
        401,
        "bad_credentials",
      );
    }

    // 计数器前进（防克隆）+ 最近使用时间
    await db
      .update(passkeyCredentials)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeyCredentials.id, row.pk.id));

    // 与密码登录同款：pending2fa 会话，TOTP 已启用则还需完成挑战
    await createSession(row.user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    const confirmed = await hasConfirmedTotp(row.user.id);
    return ok({ status: confirmed ? "2fa_challenge" : "2fa_setup" });
  });
}
