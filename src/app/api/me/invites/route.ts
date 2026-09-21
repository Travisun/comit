import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { unauthorized } from "@/core/errors";
import {ok, withApi, withUser, jsonBody} from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { createInvite, listInvites, MAX_INVITES_PER_USER } from "@/lib/auth/invite";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { withAdvisoryLock } from "@/lib/pg-lock";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/invites — my invite codes with usage info. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();

    const rows = await listInvites(user.id);
    const usedBy = rows.map((r) => r.usedBy).filter((v): v is string => Boolean(v));
    const usedByUsers = usedBy.length
      ? await db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, usedBy))
      : [];
    const nameById = new Map(usedByUsers.map((u) => [u.id, u.username]));

    const unused = rows.filter((r) => !r.usedBy).length; // matches createInvite's quota

    return ok({
      codes: rows.map((r) => ({
        code: r.code,
        createdAt: r.createdAt,
        usedAt: r.usedAt,
        usedByUsername: r.usedBy ? nameById.get(r.usedBy) ?? null : null,
      })),
      remaining: Math.max(0, MAX_INVITES_PER_USER - unused),
      max: MAX_INVITES_PER_USER,
    });
  });
}

const postSchema = z.object({}).optional();

/** POST /api/me/invites — generate a new invite code (max 5 unused). */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    parseOrThrow(postSchema, await jsonBody(req).catch(() => ({})));
    await rateLimitBucket("invite.create", auth.user.id);
    // 未使用邀请码配额与插入同临界区（并发下 count-then-insert 可越限，见 lib/pg-lock）
    const code = await withAdvisoryLock(`invite:${auth.user.id}`, (tx) => createInvite(tx, auth.user.id));
    return ok({ code });
  });
}
