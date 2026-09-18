import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { passkeyCredentials } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/me/passkeys/[id] — 删除自己的一把通行密钥。 */
export async function DELETE(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    const rows = await db
      .delete(passkeyCredentials)
      .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, auth.user.id)))
      .returning({ id: passkeyCredentials.id });
    return ok({ deleted: rows.length > 0 });
  });
}
