import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts, type Post } from "@/db/schema";
import { hooks } from "@/core/hooks";
import { runPostSaved, runPostSaving } from "@/core/capabilities/post-lifecycle";
import type { AuthContext } from "@/lib/auth/session";

/**
 * 文章仓储层（C1，Laravel Eloquent observers 对应物）—
 * 所有「核心写入路径」统一经此仓储，生命周期钩子在仓储内触发：
 * admin 路由、导入工具、seed 等后续接入后即可全覆盖（路由内散落写法退役）。
 */

export interface PostRepoAuthor {
  id: string;
  username: string;
  role: string;
}

async function saving(
  action: "create" | "update",
  author: PostRepoAuthor,
  payload: Record<string, unknown>,
  postId?: string,
): Promise<void> {
  const ctx = {
    action,
    postId,
    payload,
    author,
    rejection: null as string | null,
    reject(reason: string) {
      ctx.rejection = reason;
    },
  };
  await runPostSaving(ctx);
  if (ctx.rejection) {
    const { AppError } = await import("@/core/errors");
    throw new AppError(ctx.rejection, 422, "extension_rejected");
  }
}

async function saved(action: "create" | "update", post: Post, authorId: string): Promise<void> {
  await runPostSaved({
    action,
    post: { id: post.id, type: post.type, status: post.status, title: post.title },
    author: { id: authorId },
  });
}

export const postRepo = {
  /** 创建（含 post:saving / post:saved 钩子） */
  async create(values: typeof posts.$inferInsert, author: PostRepoAuthor): Promise<Post> {
    const payload: Record<string, unknown> = { ...values };
    await saving("create", author, payload);
    const [row] = await db.insert(posts).values(payload as typeof posts.$inferInsert).returning();
    await saved("create", row, author.id);
    return row;
  },

  /** 更新（含钩子） */
  async update(
    postId: string,
    values: Partial<typeof posts.$inferInsert>,
    author: PostRepoAuthor,
  ): Promise<Post> {
    const payload: Record<string, unknown> = { ...values };
    await saving("update", author, payload, postId);
    const [row] = await db.update(posts).set(payload).where(eq(posts.id, postId)).returning();
    await saved("update", row, author.id);
    return row;
  },

  /** 平台内部读取（供 admin/导入等路径复用，含作者校验） */
  async getAuthorPost(postId: string, authorId: string): Promise<Post | null> {
    const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    return row && row.authorId === authorId ? row : null;
  },

  /** 判断用户是否可改帖（供测试/预检使用；路由内走 policies） */
  async canUpdate(user: AuthContext["user"], post: Post): Promise<boolean> {
    return user.id === post.authorId || user.role === "admin";
  },

  eq,
};
