import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/db";
import { media, users } from "@/db/schema";
import { hooks } from "@/core/hooks";
import { AppError, ok, withUser } from "@/lib/http";
import { verifyPassword } from "@/lib/auth/password";
import { destroyUserSessions } from "@/lib/auth/session";
import { deleteMediaFile } from "@/lib/media";
import { config } from "@/core/config";
import { parseOrThrow } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().optional(),
  deleteContent: z.boolean(),
});

/**
 * DELETE /api/me — GDPR self-service account deletion.
 *  - deleteContent=true  → remove media files, cascade-delete the user row
 *                          (posts, comments, tokens, webhooks… all go).
 *  - deleteContent=false → anonymize: keep content, scrub identity fields.
 */
export async function DELETE(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(schema, await req.json().catch(() => null));

    if (auth.user.passwordHash) {
      const okPw = body.password
        ? await verifyPassword(body.password, auth.user.passwordHash)
        : false;
      if (!okPw) {
        throw new AppError("密码验证失败 / Password verification failed", 400, "bad_password");
      }
    }

    // 注销前钩子（扩展可拒绝：数据导出未完成/订阅未结算等）
    const deletingCtx = {
      userId: auth.user.id,
      deleteContent: body.deleteContent === true,
      rejection: null as string | null,
      reject(reason: string) {
        deletingCtx.rejection = reason;
      },
    };
    await hooks.callHook("user:deleting", deletingCtx);
    if (deletingCtx.rejection) {
      throw new AppError(deletingCtx.rejection, 422, "extension_rejected");
    }

    if (body.deleteContent) {
      // delete media files first (rows cascade with the user below)
      const files = await db
        .select({ path: media.path })
        .from(media)
        .where(eq(media.userId, auth.user.id));
      await Promise.all(files.map((f) => deleteMediaFile(f.path)));

      await db.transaction(async (tx) => {
        // user row cascade removes posts/comments/sessions/tokens/webhooks/etc.
        await tx.delete(users).where(eq(users.id, auth.user.id));
      });
    } else {
      // anonymize — keep content, scrub personal data
      const anonUsername = `deleted-user-${auth.user.id.slice(0, 8)}`;
      await db
        .update(users)
        .set({
          email: `deleted-${auth.user.id}@anonymous.local`,
          username: anonUsername,
          displayName: "已注销用户",
          bio: "",
          avatarPath: null,
          coverPath: null,
          github: null,
          orcid: null,
          website: null,
          subdomain: null,
          status: "deleted",
          passwordHash: null,
          updatedAt: new Date(),
          deletedAt: new Date(),
        })
        .where(eq(users.id, auth.user.id));
      await destroyUserSessions(auth.user.id);
    }

    // current cookie is dead either way
    const store = await cookies();
    store.delete(config.auth.sessionCookie);
    return ok();
  });
}
