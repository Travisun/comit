import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { routes, absolute } from "@/core/routes";
import { emit } from "@/core/events";
import { consumeAuthToken } from "@/lib/auth/guards";

export const runtime = "nodejs";

/** Email verification link: /api/auth/verify?token=… */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const userId = token ? await consumeAuthToken(token, "email_verify") : null;
    if (!userId) {
      return NextResponse.redirect(absolute(`${routes.verifyEmail}?error=1`));
    }
    const [user] = await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (user) {
      await emit("user:registered", {
        userId: user.id,
        email: user.email,
        username: user.username,
        invitedByUserId: null,
      });
    }
    return NextResponse.redirect(absolute(`${routes.login}?verified=1`));
  } catch (err) {
    console.error("[auth/verify] failed:", err);
    return NextResponse.redirect(absolute(`${routes.verifyEmail}?error=1`));
  }
}
