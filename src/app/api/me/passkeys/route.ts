import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { passkeyCredentials } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/passkeys — 当前用户的通行密钥列表。 */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    const rows = await db
      .select({
        id: passkeyCredentials.id,
        name: passkeyCredentials.name,
        deviceType: passkeyCredentials.deviceType,
        backedUp: passkeyCredentials.backedUp,
        lastUsedAt: passkeyCredentials.lastUsedAt,
        createdAt: passkeyCredentials.createdAt,
      })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, auth.user.id))
      .orderBy(desc(passkeyCredentials.createdAt));
    return ok({ passkeys: rows });
  });
}
