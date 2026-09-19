import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { extBadgeWear, extBadges, follows, users } from "@/db/schema";
import { getWornBadgesByUsernames } from "@/extensions/badges/server";
import { apiUser } from "@/lib/auth/guards";
import { ok } from "@/lib/http";
import { notFound } from "@/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ username: string }> };

/** GET /api/users/[username]/card — 用户 hover 卡片数据（公开端点）。 */
export async function GET(req: Request, ctx: Ctx) {
  const { username } = await ctx.params;
  const u = username.toLowerCase();

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarPath: users.avatarPath,
      bio: users.bio,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.username, u))
    .limit(1);
  if (!user || user.id === undefined) throw notFound("用户不存在 / User not found");

  // 佩戴徽章
  const worn = await db
    .select({ name: extBadges.name, text: extBadges.text, icon: extBadges.icon, style: extBadges.style })
    .from(extBadgeWear)
    .innerJoin(extBadges, eq(extBadges.id, extBadgeWear.badgeId))
    .where(and(eq(extBadgeWear.userId, user.id), eq(extBadges.enabled, true)))
    .limit(3);

  // 观众关注态
  const viewer = await apiUser();
  let following = false;
  let isSelf = false;
  if (viewer) {
    isSelf = viewer.user.id === user.id;
    if (!isSelf) {
      const [f] = await db
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(and(eq(follows.followerId, viewer.user.id), eq(follows.followeeId, user.id)))
        .limit(1);
      following = Boolean(f);
    }
  }

  return ok({
    username: user.username,
    displayName: user.displayName,
    avatarPath: user.avatarPath,
    bio: user.bio ?? "",
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    badges: worn,
    isSelf,
    following,
    viewerSignedIn: Boolean(viewer),
  });
}
