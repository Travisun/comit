import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { absolute } from "@/core/routes";
import { consumeAuthToken } from "@/lib/auth/guards";

export const runtime = "nodejs";

/** 换绑邮箱确认链接：/api/auth/email/confirm?token=…
 * 消费 email_verify token，把用户的 pendingEmail 落库为正式邮箱。 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const back = (ok: boolean) => absolute(`/settings/email?${ok ? "updated=1" : "error=1"}`);
  try {
    const userId = token ? await consumeAuthToken(token, "email_verify") : null;
    if (!userId) return NextResponse.redirect(back(false));

    const [user] = await db
      .select({ pendingEmail: users.pendingEmail })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.pendingEmail) return NextResponse.redirect(back(false));

    await db
      .update(users)
      .set({
        email: user.pendingEmail,
        pendingEmail: null,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return NextResponse.redirect(back(true));
  } catch (err) {
    console.error("[auth/email/confirm] failed:", err);
    return NextResponse.redirect(back(false));
  }
}
