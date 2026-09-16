import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";
import { parseJsonBody } from "../_lib/validate";

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
    // 统一走 parseJsonBody：ZodError 映射为 400 校验错误，而非裸 parse 逃逸成 500
    const { password } = await parseJsonBody(req, schema);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return ok({ ok: true });
  });
}
