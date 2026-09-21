import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import {AppError, ok, withUser, jsonBody} from "@/lib/http";
import { hooks } from "@/core/hooks";
import { emit } from "@/core/events";
import { hashPassword, isValidPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAuthTokens } from "@/lib/auth/guards";
import { destroyUserSessions } from "@/lib/auth/session";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1),
});

/**
 * POST /api/me/password — change password. OAuth-only accounts (no stored
 * hash) may omit currentPassword. All other sessions are revoked on success.
 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(schema, await jsonBody(req).catch(() => null));

    if (auth.user.passwordHash) {
      const okPw = body.currentPassword
        ? await verifyPassword(body.currentPassword, auth.user.passwordHash)
        : false;
      if (!okPw) {
        throw new AppError("当前密码不正确 / Current password is incorrect", 400, "bad_password");
      }
    }

    if (!isValidPassword(body.newPassword)) {
      throw new AppError(
        "新密码至少 8 位，且包含字母和数字 / Password must be 8+ chars with letters and digits",
        400,
        "weak_password",
      );
    }

    const changingCtx = {
        userId: auth.user.id,
        rejection: null as string | null,
        reject(reason: string) {
          changingCtx.rejection = reason;
        },
      };
      await hooks.callHook("password:changing", changingCtx);
      if (changingCtx.rejection) {
        throw new AppError(changingCtx.rejection, 422, "extension_rejected");
      }

      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));

      await emit("auth:password.changed", { userId: auth.user.id });

    // kick out every other device
    await destroyUserSessions(auth.user.id, auth.sessionId);
    // 待决一次性令牌同样作废（当前会话已证明合法性，API 令牌保留）：
    // 改密通常正是「怀疑被盗后的止损动作」，24h 内仍有效的 email_verify 链接
    // 必须随之失效，否则攻击者可用它把邮箱改回去完成二次接管。
    await revokeAuthTokens(auth.user.id);
    return ok();
  });
}
