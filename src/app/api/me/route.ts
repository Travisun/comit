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
import { asStorageTag, type StorageTag } from "@/lib/storage";
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
      // 事务内先收集媒体路径+驱动、再删 user（media 行随级联删除）；全部 DB 删除
      // 提交成功后才清理文件 —— 事务回滚时文件仍完好，不再出现
      // 「文件已删、用户还在」的不可逆不一致。
      const mediaFiles: { path: string; storage: StorageTag }[] = [];
      await db.transaction(async (tx) => {
        const files = await tx
          .select({ path: media.path, storage: media.storage })
          .from(media)
          .where(eq(media.userId, auth.user.id));
        mediaFiles.push(...files.map((f) => ({ path: f.path, storage: asStorageTag(f.storage) })));
        // user row cascade removes posts/comments/sessions/tokens/webhooks/etc.
        await tx.delete(users).where(eq(users.id, auth.user.id));
      });

      // 文件清理放在事务后（顺序不可变）：按各行的驱动分派删除，单个失败仅
      // 告警；R2 配置不可用时 deleteMediaFile 自动转 storage.delete 队列持久重试
      //（deleteMediaFile 内部兜住，不阻断注销响应）
      await Promise.all(
        mediaFiles.map((f) =>
          deleteMediaFile(f.path, f.storage).catch((err: unknown) => {
            console.warn(`[me] 媒体文件删除失败 / Failed to remove media file: ${f.path}`, err);
          }),
        ),
      );
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
