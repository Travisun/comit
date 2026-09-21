import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { authTokens, users } from "@/db/schema";
import { absolute } from "@/core/routes";
import { consumeAuthToken, revokeAuthTokens } from "@/lib/auth/guards";
import { sha256 } from "@/lib/auth/password";

export const runtime = "nodejs";

/** drizzle 把底层 pg 错误包进 DrizzleQueryError.cause；逐层解包查唯一冲突 23505 */
function isPgUniqueViolation(err: unknown, constraint?: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur instanceof Error; depth += 1) {
    const e = cur as Error & { code?: string; constraint?: string };
    if (e.code === "23505" && (!constraint || e.constraint === constraint)) return true;
    cur = e.cause;
  }
  return false;
}

/** 换绑邮箱确认链接：/api/auth/email/confirm?token=…
 * 消费 email_verify token，把用户的 pendingEmail 落库为正式邮箱。 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const back = (ok: boolean) => absolute(`/settings/email?${ok ? "updated=1" : "error=1"}`);
  try {
    const userId = token ? await consumeAuthToken(token, "email_verify") : null;
    if (!userId) return NextResponse.redirect(back(false));

    const [user] = await db
      .select({ pendingEmail: users.pendingEmail })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.pendingEmail) return NextResponse.redirect(back(false));

    // 复查：发起换绑到确认之间，新邮箱可能已被其他账户抢注（users_email_key）
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, user.pendingEmail))
      .limit(1);
    if (clash && clash.id !== userId) {
      // 清掉对应 token，并重定向到明确错误码（区别于笼统 error=1）
      await db
        .delete(authTokens)
        .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.type, "email_verify")));
      return NextResponse.redirect(absolute("/settings/email?error=taken"));
    }

    try {
      await db
        .update(users)
        .set({
          email: user.pendingEmail,
          pendingEmail: null,
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      // 换绑成功 = 登录标识符变更：此前发到**旧邮箱**的 password_reset 链接
      // （30 分钟窗口）若仍有效，可把新邮箱账户的密码重置掉（旧邮箱可能已被
      // 回收/转卖/属他人）。同类型的 email_verify 残留一并吊销。
      await revokeAuthTokens(userId);
    } catch (err) {
      // 复查与落库之间的并发窗口兜底
      if (isPgUniqueViolation(err, "users_email_key")) {
        return NextResponse.redirect(absolute("/settings/email?error=taken"));
      }
      throw err;
    }

    return NextResponse.redirect(back(true));
  } catch (err) {
    console.error("[auth/email/confirm] failed:", err);
    return NextResponse.redirect(back(false));
  }
}
