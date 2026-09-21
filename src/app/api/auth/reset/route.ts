import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { emit } from "@/core/events";
import { consumeAuthToken, revokeAuthTokens } from "@/lib/auth/guards";
import { revokeAllApiTokens } from "@/lib/tokens";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { destroyUserSessions } from "@/lib/auth/session";
import { parseJsonBody } from "../_lib/validate";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(10, "重置链接无效 / Invalid reset link"),
  password: z.string().min(1, "请输入新密码 / New password required"),
});

export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.password", clientIp(req));
    const body = await parseJsonBody(req, schema);
    if (!isValidPassword(body.password)) {
      throw new AppError(
        "密码至少 8 位，需包含字母和数字 / Password must be 8+ chars with letters and numbers",
        400,
        "weak_password",
      );
    }

    const userId = await consumeAuthToken(body.token, "password_reset");
    if (!userId) {
      throw new AppError("重置链接无效或已过期 / Reset link is invalid or expired", 400, "bad_token");
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() })
      .where(eq(users.id, userId));
    // any thief holding an old session is signed out
    await destroyUserSessions(userId);
    // 一次性令牌与 API 令牌同生命周期一起作废：找回密码只证明邮箱控制权，
    // 残留的 email_verify 链接（24h）可把邮箱改回攻击者地址、残留的 API 令牌
    // （不经会话体系）可绕过刚做完的会话吊销 —— 两者都必须在此断掉。
    await revokeAuthTokens(userId);
    await revokeAllApiTokens(userId);
    await emit("auth:password.reset", { userId });

    return ok({ ok: true, message: "密码已重置，请使用新密码登录 / Password reset, sign in with the new password" });
  });
}
