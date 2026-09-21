import { z } from "zod";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError, forbidden } from "@/core/errors";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { getSetting } from "@/lib/settings";
import { parseJsonBody } from "../_lib/validate";

export const runtime = "nodejs";

const BAD_CREDENTIALS = "邮箱或密码错误 / Incorrect email or password";

// 时序防护用固定 dummy 哈希（scrypt$N$salt$key，值与环境无关）。用户不存在时
// 也对其跑一遍同样的 scrypt 验证，使响应耗时与真实用户一致，防枚举。
const DUMMY_HASH = `scrypt$16384$${"0".repeat(32)}$${"0".repeat(128)}`;

const schema = z
  .object({
    /** 邮箱或用户名（登录页统一标识符字段；兼容旧客户端的 email 字段名） */
    identifier: z.string().trim().toLowerCase().min(1, BAD_CREDENTIALS).optional(),
    email: z.string().trim().toLowerCase().min(1, BAD_CREDENTIALS).optional(),
    password: z.string().min(1, BAD_CREDENTIALS),
  })
  .refine((d) => Boolean(d.identifier ?? d.email), { message: BAD_CREDENTIALS });

export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.login", clientIp(req));
    // 后台关闭密码登录（仅 OSS）时拒绝：放在限流后、任何查询前
    if (!(await getSetting("auth.passwordAuth"))) {
      throw forbidden("站点已关闭密码登录，请使用第三方登录 / Password sign-in is disabled, use federated sign-in");
    }
    const body = await parseJsonBody(req, schema);
    const identifier = (body.identifier ?? body.email)!;
    // 账号级兜底：IP 桶可被代理池/伪造 X-Real-IP 绕过，这里按标识符再限一次，
    // 使对单一账号的分布式撞库在 15 分钟窗口内最多 10 次。
    await rateLimitBucket("auth.login.account", identifier);

    // 邮箱或用户名登录：两个唯一列都可能是命中项；用户名与邮箱统一小写存储
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.username, identifier)))
      .limit(1);
    // 无论用户是否存在都执行一次同构的 scrypt 验证（不存在时对 dummy 哈希）
    const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || user.status === "deleted" || user.deletedAt || !passwordOk) {
      throw new AppError(BAD_CREDENTIALS, 401, "bad_credentials");
    }
    if (user.status === "suspended") {
      const until = user.bannedUntil;
      const reason = user.banReason?.trim() || "未说明原因 / no reason given";
      if (until && until.getTime() > Date.now()) {
        // timed ban still in effect → tell the user when it lifts
        const locale = user.locale === "en" ? "en-US" : "zh-CN";
        const when = until.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
        throw forbidden(
          locale === "zh-CN"
            ? `账号已被封禁至 ${when}：${reason}`
            : `Account banned until ${when}: ${reason}`,
        );
      }
      if (!until) {
        throw forbidden(`账号已被永久封禁：${reason} / Account permanently banned: ${reason}`);
      }
      // expired timed ban → treat as auto-unban: restore the account and let
      // the user in (the session layer already admits them once bannedUntil passed).
      await db
        .update(users)
        .set({ status: "active", bannedUntil: null, banReason: null })
        .where(eq(users.id, user.id));
    }

    // 2FA is mandatory: every login starts as a pending session
    await createSession(user.id, {
      pending2fa: true,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    const confirmed = await hasConfirmedTotp(user.id);

    return ok({ status: confirmed ? "2fa_challenge" : "2fa_setup" });
  });
}
