import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { extBadgeGrants, extBadges, extBadgeWear } from "@/db/schema";
import { ok, withUser } from "@/lib/http";
import { getUserBadges, WEAR_LIMIT } from "@/extensions/badges/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/badges — 我获得的徽章 + 佩戴状态。 */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    return ok(await getUserBadges(auth.user.id));
  });
}

const wearSchema = z.object({
  badgeIds: z.array(z.string().uuid()).max(WEAR_LIMIT),
});

/** PUT /api/me/badges — 整体设置佩戴的徽章（≤ WEAR_LIMIT 枚，必须已获得）。 */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = wearSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "参数错误 / Invalid payload", code: "bad_request" },
        { status: 400 },
      );
    }
    const ids = [...new Set(parsed.data.badgeIds)];

    // 必须全部为本人已获得的启用徽章
    const owned = ids.length
      ? await db
          .select({ badgeId: extBadgeGrants.badgeId })
          .from(extBadgeGrants)
          .innerJoin(extBadges, eq(extBadges.id, extBadgeGrants.badgeId))
          .where(
            and(
              eq(extBadgeGrants.userId, auth.user.id),
              inArray(extBadgeGrants.badgeId, ids),
              eq(extBadges.enabled, true),
            ),
          )
      : [];
    if (owned.length !== ids.length) {
      return Response.json(
        { error: "包含未获得或不可用的徽章 / badge not owned", code: "badge_not_owned" },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(extBadgeWear).where(eq(extBadgeWear.userId, auth.user.id));
      if (ids.length) {
        await tx
          .insert(extBadgeWear)
          .values(ids.map((badgeId) => ({ userId: auth.user.id, badgeId })))
          .onConflictDoNothing();
      }
    });

    return ok(await getUserBadges(auth.user.id));
  });
}
