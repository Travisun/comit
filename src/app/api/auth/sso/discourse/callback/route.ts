import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routes, absolute } from "@/core/routes";
import { clientIp } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { verifyDiscourseCallback } from "@/lib/auth/oauth";
import { findOrCreateFederatedUser } from "../../../_lib/federated";

export const runtime = "nodejs";

function decodePayloadNonce(sso: string): string | null {
  try {
    return new URLSearchParams(Buffer.from(sso, "base64").toString("utf8")).get("nonce");
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    const url = new URL(req.url);
    const sso = url.searchParams.get("sso") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const cookieNonce = req.cookies.get("mb_sso_nonce")?.value ?? "";

    // verifyDiscourseCallback only checks the HMAC; the nonce is our CSRF guard
    if (!sso || !sig || !cookieNonce || decodePayloadNonce(sso) !== cookieNonce) {
      return NextResponse.redirect(loginError);
    }
    const profile = await verifyDiscourseCallback(sso, sig);
    if (!profile) return NextResponse.redirect(loginError);

    const { user } = await findOrCreateFederatedUser(profile);
    await createSession(user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const target = (await hasConfirmedTotp(user.id)) ? routes.twofaChallenge : routes.twofaSetup;
    const res = NextResponse.redirect(absolute(target));
    res.cookies.delete("mb_sso_nonce");
    return res;
  } catch (err) {
    console.error("[auth/sso/discourse] callback failed:", err);
    return NextResponse.redirect(loginError);
  }
}
