import { withApi, ok } from "@/lib/http";
import { destroyCurrentSession, getCurrentUser } from "@/lib/auth/session";
import { emit } from "@/core/events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser().catch(() => null);
    await destroyCurrentSession();
    await emit("auth:logout", { userId: user?.id ?? null });
    return ok({ ok: true });
  });
}
