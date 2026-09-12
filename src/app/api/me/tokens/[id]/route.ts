import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { notFound, ok, withUser } from "@/lib/http";
import { parseOrThrow } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/** DELETE /api/me/tokens/[id] — revoke (never delete, keeps the audit trail). */
export async function DELETE(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);

    const rows = await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, id),
          eq(apiTokens.userId, auth.user.id),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    if (!rows.length) throw notFound("令牌不存在或已吊销 / Token not found or already revoked");
    return ok();
  });
}
