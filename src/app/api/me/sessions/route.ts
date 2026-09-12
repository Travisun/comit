import { ok, withUser } from "@/lib/http";
import { cookies } from "next/headers";
import { config } from "@/core/config";
import { destroyUserSessions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/me/sessions — sign out other devices (`?keepCurrent=1`)
 * or everything (no param).
 */
export async function DELETE(req: Request) {
  return withUser(req, async (auth) => {
    const keepCurrent = new URL(req.url).searchParams.get("keepCurrent") === "1";
    await destroyUserSessions(auth.user.id, keepCurrent ? auth.sessionId : undefined);
    if (!keepCurrent) {
      const store = await cookies();
      store.delete(config.auth.sessionCookie);
    }
    return ok();
  });
}
