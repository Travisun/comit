import { NextResponse } from "next/server";

import { config } from "@/core/config";
import { routes, absolute } from "@/core/routes";
import { getSetting } from "@/lib/settings";
import { randomToken } from "@/lib/auth/password";
import { discourseSsoStartUrl, oauthEnabled } from "@/lib/auth/oauth";
import { issueFlowParam } from "../../_lib/flow-nonce";

export const runtime = "nodejs";

export async function GET() {
  const loginError = absolute(`${routes.login}?error=oauth`);
  try {
    if (!(await oauthEnabled("discourse")) || !(await getSetting("sso.discourse"))) {
      return NextResponse.redirect(loginError);
    }
    const nonce = randomToken(16);
    // 服务端登记 nonce 为一次性票据（128 位随机 + 单次消费）：Discourse 回包
    // 的签名 payload 本身永不过期（协议内无时间戳），cookie 只能证明同浏览器，
    // 消费登记才挡住回调重放。
    await issueFlowParam("sso_nonce", nonce);
    const res = NextResponse.redirect(await discourseSsoStartUrl(nonce, "/api/auth/sso/discourse/callback"));
    res.cookies.set("mb_sso_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.app.isProd,
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    console.error("[auth/sso/discourse] start failed:", err);
    return NextResponse.redirect(loginError);
  }
}
