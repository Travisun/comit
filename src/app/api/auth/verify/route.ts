import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { routes, absolute } from "@/core/routes";
import { emit } from "@/core/events";
import { consumeAuthToken } from "@/lib/auth/guards";

export const runtime = "nodejs";

/**
 * Email verification link: /api/auth/verify?token=…
 * 消费 token 后不再直接跳登录页，而是回到 /auth/verify 页面按状态渲染
 * （verified=1 成功态 / error=1 失效态），由页面给出「继续登录」引导。
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const userId = token ? await consumeAuthToken(token, "email_verify") : null;
    if (!userId) {
      return NextResponse.redirect(absolute(`${routes.verifyEmail}?error=1`));
    }
    // 先读旧值：已验证过（重复点击链接/二次验证）不再重复发 registered 事件
    const [before] = await db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [user] = await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (user && !before?.emailVerifiedAt) {
      await emit("user:registered", {
        userId: user.id,
        email: user.email,
        username: user.username,
        invitedByUserId: null,
      });
    }
    return NextResponse.redirect(absolute(`${routes.verifyEmail}?verified=1`));
  } catch (err) {
    console.error("[auth/verify] failed:", err);
    return NextResponse.redirect(absolute(`${routes.verifyEmail}?error=1`));
  }
}
