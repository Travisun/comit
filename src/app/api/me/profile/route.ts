import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { assertOwnMedia, emptyToNull, localeSchema, maskEmail, parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/profile — full own profile (email masked). */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "请先登录 / Sign in required" }, { status: 401 });
    return ok({
      id: user.id,
      username: user.username,
      email: maskEmail(user.email),
      displayName: user.displayName,
      bio: user.bio,
      github: user.github,
      orcid: user.orcid,
      website: user.website,
      locale: user.locale === "en" ? "en" : "zh",
      avatarPath: user.avatarPath,
      coverPath: user.coverPath,
      hideFollowers: user.hideFollowers,
      hideFollowing: user.hideFollowing,
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt,
    });
  });
}

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z.string().max(200, "一句话介绍最多 200 字 / Bio too long").optional(),
  github: z.string().trim().max(120).optional(),
  orcid: z.string().trim().max(40).optional(),
  website: z.string().trim().max(320).optional(),
  locale: localeSchema.optional(),
  avatarPath: z.string().nullable().optional(),
  coverPath: z.string().nullable().optional(),
  hideFollowers: z.boolean().optional(),
  hideFollowing: z.boolean().optional(),
});

/** PUT /api/me/profile — update profile fields. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(patchSchema, await req.json().catch(() => null));
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.github !== undefined) patch.github = emptyToNull(body.github)?.replace(/^@/, "") ?? null;
    if (body.orcid !== undefined) patch.orcid = emptyToNull(body.orcid);
    if (body.website !== undefined) {
      const w = emptyToNull(body.website);
      patch.website = w && !/^https?:\/\//i.test(w) ? `https://${w}` : w;
    }
    if (body.locale !== undefined) patch.locale = body.locale;
    if (body.avatarPath !== undefined) {
      if (body.avatarPath) await assertOwnMedia(auth.user.id, body.avatarPath);
      patch.avatarPath = body.avatarPath;
    }
    if (body.coverPath !== undefined) {
      if (body.coverPath) await assertOwnMedia(auth.user.id, body.coverPath);
      patch.coverPath = body.coverPath;
    }
    if (body.hideFollowers !== undefined) patch.hideFollowers = body.hideFollowers;
    if (body.hideFollowing !== undefined) patch.hideFollowing = body.hideFollowing;

    await db.update(users).set(patch).where(eq(users.id, auth.user.id));
    return ok();
  });
}
