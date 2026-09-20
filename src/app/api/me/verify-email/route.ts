import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { routes, absolute } from "@/core/routes";
import { ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { verifyPassword } from "@/lib/auth/password";
import { issueAuthToken } from "@/lib/auth/guards";
import { renderMail, sendMail } from "@/lib/mail";
import type { Locale } from "@/lib/i18n";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("邮箱格式不正确 / Invalid email address"));

const postSchema = z.object({
  /** 留空 = 向当前邮箱重发验证邮件；提供 = 先换绑到新邮箱再发送（验证前纠错、OSS 合成邮箱换真实地址） */
  newEmail: emailSchema.optional(),
  /** 有密码的账户换绑时必填；重发不需要 */
  password: z.string().optional(),
});

/**
 * POST /api/me/verify-email —— 会话内重发验证邮件 / 验证完成前换绑邮箱。
 *
 * 仅未验证账户可用（已验证账户的换绑走 /api/me/email 的 pendingEmail 流程）。
 * 未验证账户被仪表盘硬门槛挡在 /auth/verify，此前没有任何改邮箱入口 ——
 * 注册时邮箱打错或 OSS 合成邮箱（收不到验证信）会永久死锁，本路由即解法。
 *
 * 限频：auth.verifyEmail 桶按用户 3 次/10 分钟（重发与换绑共用）；
 * 换绑时对有密码账户额外验密，防会话被盗后静默接管邮箱。
 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    if (auth.user.emailVerifiedAt) {
      throw new AppError("邮箱已完成验证 / Email already verified", 400, "already_verified");
    }
    await rateLimitBucket("auth.email.resend", `user:${auth.user.id}`);
    const body = parseOrThrow(postSchema, await req.json().catch(() => null));

    const currentEmail = auth.user.email.toLowerCase();
    const target = body.newEmail ?? currentEmail;

    if (target !== currentEmail) {
      // 换绑：有密码的账户必须验密；纯 OAuth/SSO 账户没有密码可验，跳过
      if (auth.user.passwordHash) {
        const okPw = body.password
          ? await verifyPassword(body.password, auth.user.passwordHash)
          : false;
        if (!okPw) throw new AppError("密码错误 / Incorrect password", 403, "bad_password");
      }
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, target), ne(users.id, auth.user.id)))
        .limit(1);
      if (taken) throw forbidden("该邮箱已被其他账户使用 / Email already in use");

      await db
        .update(users)
        .set({ email: target, pendingEmail: null, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));
    }

    const token = await issueAuthToken(auth.user.id, "email_verify", 60 * 24);
    const verifyUrl = absolute(`${routes.verifyEmailApi}?token=${encodeURIComponent(token)}`);
    const locale = (auth.user.locale === "en" ? "en" : "zh") as Locale;
    const mail = renderMail("verifyEmail", locale, { url: verifyUrl });
    await sendMail({ to: target, ...mail });

    return ok({ ok: true, message: "验证邮件已发送 / Verification email sent" });
  });
}
