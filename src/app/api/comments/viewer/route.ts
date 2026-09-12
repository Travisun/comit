import { ok, withApi } from "@/lib/http";
import { apiUser } from "@/lib/auth/guards";

/** GET /api/comments/viewer — lightweight current-user info for social UI. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const viewer = await apiUser();
    if (!viewer) return ok(null);
    return ok({
      id: viewer.user.id,
      username: viewer.user.username,
      displayName: viewer.user.displayName,
      avatarPath: viewer.user.avatarPath,
    });
  });
}
