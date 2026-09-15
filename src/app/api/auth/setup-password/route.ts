import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  password: z
    .string()
    .min(8, "密码至少 8 位，需包含字母和数字 / Password must be 8+ chars")
    .regex(/[a-zA-Z]/, "密码需包含字母 / Must contain a letter")
    .regex(/[0-9]/, "密码需包含数字 / Must contain a digit"),
});

/** POST /api/auth/setup-password — 首次登录引导：为无密码账户（OAuth 注册）
 * 设置登录密码。仅在尚未设置密码时允许，已设置需走修改密码流程。 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    if (auth.user.passwordHash) {
      throw forbidden(
        "已设置过密码，请使用修改密码功能 / Password already set — use change password",
      );
    }
    const { password } = schema.parse(await jsonBody(req));
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return ok({ ok: true });
  });
}
