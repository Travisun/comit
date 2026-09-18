import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/me/onboarding/complete — 标记注册引导完成（幂等）。 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    if (!auth.user.onboardedAt) {
      await db
        .update(users)
        .set({ onboardedAt: new Date() })
        .where(eq(users.id, auth.user.id));
    }
    return ok({ ok: true });
  });
}
