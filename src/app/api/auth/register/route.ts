import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { hooks } from "@/core/hooks";
import { emit } from "@/core/events";
import { db } from "@/db";
import { follows, invites, users, type User } from "@/db/schema";
import { AppError, conflict, forbidden } from "@/core/errors";
import { routes, absolute } from "@/core/routes";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { getSetting } from "@/lib/settings";
import { assertUsernameAvailable } from "@/lib/users";
import { hashPassword, isValidPassword } from "@/lib/auth/password";
import { issueAuthToken } from "@/lib/auth/guards";
import { renderMail, sendMail } from "@/lib/mail";
import type { Locale } from "@/lib/i18n";
import { parseJsonBody } from "../_lib/validate";

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
    await rateLimitBucket("auth.register", clientIp(req));
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
    const needsInvite = Boolean(body.inviteCode) || inviteRequired;
    if (needsInvite && !body.inviteCode) {
      throw new AppError("注册需要邀请码 / An invite code is required", 400, "invite_required");
    }

    const locale = localeFromRequest(req);

    // 注册提交钩子（扩展可拒绝：风控/黑名单/邀请策略等）。
    // 注意钩子必须在消费邀请码之前跑：被拒绝时邀请码还不能被烧掉。
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

    // 邀请码消费 + 建号 + 邀请回填放同一事务：insert 失败即回滚，邀请码不烧毁。
    // 邀请码消费保持 consumeInvite 的原子语义（UPDATE … WHERE used_at IS NULL），
    // 只是改在事务内等价重写，避免独立连接绕过事务。
    let user: User;
    try {
      user = await db.transaction(async (tx) => {
        let inviterId: string | null = null;
        if (needsInvite && body.inviteCode) {
          const [invite] = await tx
            .update(invites)
            .set({ usedAt: new Date() })
            .where(
              and(eq(invites.code, body.inviteCode.trim().toUpperCase()), isNull(invites.usedAt)),
            )
            .returning({ createdBy: invites.createdBy });
          if (!invite) {
            throw new AppError(
              "邀请码无效或已被使用 / Invite code is invalid or already used",
              400,
              "invite_invalid",
            );
          }
          inviterId = invite.createdBy;
        }

        const [created] = await tx
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

        // invited users automatically follow their inviter
        if (inviterId && inviterId !== created.id) {
          await tx
            .insert(follows)
            .values({ followerId: created.id, followeeId: inviterId })
            .onConflictDoNothing();
          await tx.update(invites).set({ usedBy: created.id }).where(eq(invites.code, body.inviteCode!));
        }
        return created;
      });
    } catch (err) {
      // 并发兜底：查后插之间撞 users_username_key / users_email_key 唯一约束
      if (isPgUniqueViolation(err, "users_username_key")) {
        throw conflict("用户名已被占用 / Username already taken");
      }
      if (isPgUniqueViolation(err, "users_email_key")) {
        throw conflict("邮箱已被注册 / Email already registered");
      }
      if (isPgUniqueViolation(err)) {
        throw conflict("邮箱或用户名已被注册 / Email or username already registered");
      }
      throw err; // 邀请码无效等业务错误原样抛出（事务已回滚，邀请码未烧毁）
    }

    await emit("auth:registered", { userId: user.id, email: user.email, username: user.username });

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
