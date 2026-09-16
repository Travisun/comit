import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError, forbidden, unauthorized } from "@/core/errors";
import { absolute } from "@/core/routes";
import { ok, withApi, withUser } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { issueAuthToken } from "@/lib/auth/guards";
import { renderMail, sendMail } from "@/lib/mail";
import { getCurrentUser } from "@/lib/auth/session";
import type { Locale } from "@/lib/i18n";
import { parseOrThrow, maskEmail } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 确认链接落点：验证通过后由该路由把待确认地址落库 */
export const CONFIRM_PATH = "/api/auth/email/confirm";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("邮箱格式不正确 / Invalid email address"));

const postSchema = z.object({
  newEmail: emailSchema,
  password: z.string().optional(),
});

/** GET /api/me/email — 当前邮箱（脱敏）+ 待确认邮箱（脱敏）+ 是否有密码。 */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();
    return ok({
      email: maskEmail(user.email),
      pendingEmail: user.pendingEmail ? maskEmail(user.pendingEmail) : null,
      hasPassword: Boolean(user.passwordHash),
    });
  });
}

/** POST /api/me/email — 申请换绑：校验密码 → 记录待确认地址 → 发确认邮件。 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    rateLimit(`email-change:${clientIp(req)}`, 5, 300_000);
    const body = parseOrThrow(postSchema, await req.json().catch(() => null));

    const newEmail = body.newEmail;
    if (newEmail === auth.user.email.toLowerCase()) {
      throw new AppError("新邮箱与当前邮箱相同 / Same as current email", 400, "same_email");
    }
    if (auth.user.pendingEmail === newEmail) {
      return ok({ pendingEmail: maskEmail(newEmail), message: "确认邮件已发送，请查收。" });
    }

    // 有密码的账户必须验证密码；仅 OAuth 的账户跳过
    if (auth.user.passwordHash) {
      const okPw = body.password ? await verifyPassword(body.password, auth.user.passwordHash) : false;
      if (!okPw) throw new AppError("密码错误 / Incorrect password", 403, "bad_password");
    }

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), ne(users.id, auth.user.id)))
      .limit(1);
    if (taken) throw forbidden("该邮箱已被其他账户使用 / Email already in use");

    await db
      .update(users)
      .set({ pendingEmail: newEmail, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));

    const token = await issueAuthToken(auth.user.id, "email_verify", 60 * 24);
    const confirmUrl = absolute(`${CONFIRM_PATH}?token=${encodeURIComponent(token)}`);
    const locale = (auth.user.locale === "en" ? "en" : "zh") as Locale;
    const mail = renderMail("verifyEmail", locale, { url: confirmUrl });
    await sendMail({ to: newEmail, ...mail });

    return ok({
      pendingEmail: maskEmail(newEmail),
      message: "确认邮件已发送至新邮箱，点击邮件中的链接完成换绑。",
    });
  });
}
