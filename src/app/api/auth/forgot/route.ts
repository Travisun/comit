import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { routes, absolute } from "@/core/routes";
import { withApi, ok } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/rate-limit";
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
    rateLimit(`forgot:${clientIp(req)}`, 5, 60_000);
    const body = await parseJsonBody(req, schema);

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, body.email), ne(users.status, "deleted")))
      .limit(1);

    if (user) {
      const token = await issueAuthToken(user.id, "password_reset", 30);
      const resetUrl = absolute(`${routes.resetPassword(token)}`);
      const locale = (user.locale === "en" ? "en" : "zh") as Locale;
      const mail = renderMail("resetPassword", locale, { url: resetUrl });
      await sendMail({ to: user.email, ...mail });
    }
    return ok({
      ok: true,
      message: "如果该邮箱存在，重置链接已发送 / If that email exists, a reset link has been sent",
    });
  });
}
