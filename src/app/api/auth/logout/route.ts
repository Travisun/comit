import { withApi, ok } from "@/lib/http";
import { destroyCurrentSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withApi(req, async () => {
    await destroyCurrentSession();
    return ok({ ok: true });
  });
}
