import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { consumeAuthToken } from "@/lib/auth/guards";
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
    rateLimit(`reset:${clientIp(req)}`, 10, 60_000);
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

    return ok({ ok: true, message: "密码已重置，请使用新密码登录 / Password reset, sign in with the new password" });
  });
}
