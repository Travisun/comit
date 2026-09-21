import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { routes, absolute } from "@/core/routes";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { emit } from "@/core/events";
import { issueAuthToken } from "@/lib/auth/guards";
import { renderMail, sendMail } from "@/lib/mail";
import type { Locale } from "@/lib/i18n";
import { parseJsonBody } from "../_lib/validate";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("邮箱格式不正确 / Invalid email address")),
});

/** Always returns ok — never reveals whether the address is registered. */
export async function POST(req: Request) {
  return withApi(req, async () => {
    await rateLimitBucket("auth.password", clientIp(req));
    const body = await parseJsonBody(req, schema);

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, body.email), ne(users.status, "deleted")))
      .limit(1);

    if (user) {
      const token = await issueAuthToken(user.id, "password_reset", 30);
      await emit("auth:password.forgot", { userId: user.id, email: body.email });
      const resetUrl = absolute(`${routes.resetPassword(token)}`);
      const locale = (user.locale === "en" ? "en" : "zh") as Locale;
      const mail = renderMail("resetPassword", locale, { url: resetUrl });
      try {
        await sendMail({ to: user.email, ...mail });
      } catch (err) {
        // SMTP 故障不得变成 500 —— 已注册邮箱 500 / 未注册 200 会泄露账户存在性
        console.error("[forgot] reset email failed:", err);
      }
    }
    return ok({
      ok: true,
      message: "如果该邮箱存在，重置链接已发送 / If that email exists, a reset link has been sent",
    });
  });
}
