import { eq } from "drizzle-orm";
import { AppError, unauthorized } from "@/core/errors";
import { hooks } from "@/core/hooks";
import { coerceProfileFields } from "@/core/capabilities/manifest";
import { getAllProfileFieldDefs } from "@/extensions/_boot/manifests";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import {ok, withApi, withUser, jsonBody} from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { assertOwnMedia, emptyToNull, localeSchema, maskEmail, parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/profile — full own profile (email masked). */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();
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
      followersVisibility: user.followersVisibility,
      followingVisibility: user.followingVisibility,
      bookmarksVisibility: user.bookmarksVisibility,
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt,
    });
  });
}

const patchSchema = z.object({
      customFields: z.record(z.string(), z.string().max(300)).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z.string().max(200, "一句话介绍最多 200 字 / Bio too long").optional(),
  github: z.string().trim().max(120).optional(),
  orcid: z.string().trim().max(40).optional(),
  website: z.string().trim().max(320).optional(),
  locale: localeSchema.optional(),
  avatarPath: z.string().nullable().optional(),
  coverPath: z.string().nullable().optional(),
  followersVisibility: z.enum(["public", "followers", "friends", "private"]).optional(),
  followingVisibility: z.enum(["public", "followers", "friends", "private"]).optional(),
  bookmarksVisibility: z.enum(["public", "followers", "friends", "private"]).optional(),
});

/** PUT /api/me/profile — update profile fields. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(patchSchema, await jsonBody(req).catch(() => null));
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
    if (body.customFields !== undefined) {
      patch.customFields = coerceProfileFields(getAllProfileFieldDefs(), body.customFields);
    }
    if (body.followersVisibility !== undefined) patch.followersVisibility = body.followersVisibility;
    if (body.followingVisibility !== undefined) patch.followingVisibility = body.followingVisibility;
    if (body.bookmarksVisibility !== undefined) patch.bookmarksVisibility = body.bookmarksVisibility;

    // 资料保存前钩子（扩展可改写 patch 或拒绝：审核昵称/头像合规等）
    const savingCtx = {
      patch: patch as Record<string, unknown>,
      userId: auth.user.id,
      rejection: null as string | null,
      reject(reason: string) {
        savingCtx.rejection = reason;
      },
    };
    await hooks.callHook("profile:saving", savingCtx);
    if (savingCtx.rejection) {
      throw new AppError(savingCtx.rejection, 422, "extension_rejected");
    }

    await db.update(users).set(patch).where(eq(users.id, auth.user.id));
    await hooks.callHook("profile:saved", { userId: auth.user.id, patch });
    return ok();
  });
}
