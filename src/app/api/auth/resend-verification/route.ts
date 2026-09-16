import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { routes, absolute } from "@/core/routes";
import { withApi, ok } from "@/lib/http";
import { clientIp } from "@/lib/rate-limit";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
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
    await rateLimitBucket("auth.email", clientIp(req));
    const body = await parseJsonBody(req, schema);
    const generic = { ok: true, message: "如果该邮箱存在，验证邮件已重新发送 / If that email exists, a verification email has been resent" };

    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || user.emailVerifiedAt || user.status !== "active") return ok(generic);

    const token = await issueAuthToken(user.id, "email_verify", 60 * 24);
    const verifyUrl = absolute(`${routes.verifyEmail}?token=${encodeURIComponent(token)}`);
    const locale = (user.locale === "en" ? "en" : "zh") as Locale;
    const mail = renderMail("verifyEmail", locale, { url: verifyUrl });
    await sendMail({ to: user.email, ...mail });
    return ok(generic);
  });
}
