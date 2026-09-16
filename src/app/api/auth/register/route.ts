import { z } from "zod";
import { hooks } from "@/core/hooks";
import { emit } from "@/core/events";
import { db } from "@/db";
import { follows, users } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { routes, absolute } from "@/core/routes";
import { withApi, ok } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import { isValidUsername, assertUsernameAvailable } from "@/lib/users";
import { consumeInvite, markInviteUsed } from "@/lib/auth/invite";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { issueAuthToken } from "@/lib/auth/guards";
import { renderMail, sendMail } from "@/lib/mail";
import type { Locale } from "@/lib/i18n";
import { parseJsonBody } from "../_lib/validate";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("邮箱格式不正确 / Invalid email address")),
  password: z.string().min(1, "请输入密码 / Password required"),
  username: z.string().trim().toLowerCase().min(1, "请输入用户名 / Username required"),
  displayName: z.string().trim().max(80).optional(),
  inviteCode: z.string().trim().max(16).optional(),
  agree: z.literal(true, {
    message: "必须同意服务协议与隐私政策 / You must agree to the terms and privacy policy",
  }),
});

/** Guess signup locale from Accept-Language; defaults to zh. */
function localeFromRequest(req: Request): Locale {
  const first = (req.headers.get("accept-language") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  return "zh";
}

export async function POST(req: Request) {
  return withApi(req, async () => {
    rateLimit(`register:${clientIp(req)}`, 5, 60_000);
    const body = await parseJsonBody(req, schema);

    if (!(await getSetting("site.registrationOpen"))) {
      throw forbidden("当前未开放注册 / Registration is currently closed");
    }
    if (!isValidPassword(body.password)) {
      throw new AppError(
        "密码至少 8 位，需包含字母和数字 / Password must be 8+ chars with letters and numbers",
        400,
        "weak_password",
      );
    }
    await assertUsernameAvailable(body.username); // throws 409 when taken/invalid

    const inviteRequired = await getSetting("site.inviteRequired");
    let inviterId: string | null = null;
    if (body.inviteCode || inviteRequired) {
      if (!body.inviteCode) {
        throw new AppError("注册需要邀请码 / An invite code is required", 400, "invite_required");
      }
      inviterId = await consumeInvite(body.inviteCode);
      if (!inviterId) {
        throw new AppError("邀请码无效或已被使用 / Invite code is invalid or already used", 400, "invite_invalid");
      }
    }

    const locale = localeFromRequest(req);

    // 注册提交钩子（扩展可拒绝：风控/黑名单/邀请策略等）
    const savingCtx = {
      payload: {
        email: body.email,
        username: body.username,
        displayName: (body.displayName || body.username).slice(0, 80),
        locale,
      } as Record<string, unknown>,
      rejection: null as string | null,
      reject(reason: string) {
        savingCtx.rejection = reason;
      },
    };
    await hooks.callHook("register:saving", savingCtx);
    if (savingCtx.rejection) {
      throw new AppError(savingCtx.rejection, 422, "extension_rejected");
    }

    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        username: body.username,
        displayName: (body.displayName || body.username).slice(0, 80),
        passwordHash: await hashPassword(body.password),
        emailVerifiedAt: null,
        locale,
      })
      .returning();

    await emit("auth:registered", { userId: user.id, email: user.email, username: user.username });

    // invited users automatically follow their inviter
    if (inviterId && inviterId !== user.id) {
      await db
        .insert(follows)
        .values({ followerId: user.id, followeeId: inviterId })
        .onConflictDoNothing();
      await markInviteUsed(body.inviteCode!, user.id);
    }

    const token = await issueAuthToken(user.id, "email_verify", 60 * 24);
    const verifyUrl = absolute(`${routes.verifyEmail}?token=${encodeURIComponent(token)}`);
    const mail = renderMail("verifyEmail", locale as Locale, { url: verifyUrl });
    try {
      await sendMail({ to: user.email, ...mail });
    } catch (err) {
      // registration must not fail when SMTP is down; user can resend later
      console.error("[register] verify email failed:", err);
    }

    return ok({ ok: true, message: "验证邮件已发送 / Verification email sent" });
  });
}
