import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, reports, users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";

const bodySchema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

/** POST /api/reports — file a report against a post / comment / user. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    // 举报是低频操作：桶 report.create，per-user 默认 10 次/小时，防刷
    await rateLimitBucket("report.create", auth.user.id);
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { targetType, targetId, reason } = parsed.data;

    if (targetType === "user" && targetId === auth.user.id) {
      throw new AppError("不能举报自己 / You cannot report yourself", 400, "self_report");
    }
    // 目标必须存在：否则任意 uuid 都能生成一条前台查不到内容的举报，永久占据
    // 审核队列（管理端 delete_content 只能 404），且 open 计数被灌满。
    if (!(await targetExists(targetType, targetId))) {
      throw new AppError("举报目标不存在 / Report target not found", 404, "not_found");
    }

    // onConflictDoNothing：同一举报人对同一目标只允许一条未处理举报（部分唯一
    // 索引 reports_open_key）。重复提交按幂等成功返回，而不是 500。
    const [inserted] = await db
      .insert(reports)
      .values({ reporterId: auth.user.id, targetType, targetId, reason })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    return ok({ id: inserted?.id ?? null });
  });
}

async function targetExists(targetType: string, targetId: string): Promise<boolean> {
  if (targetType === "post") {
    const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, targetId)).limit(1);
    return !!row;
  }
  if (targetType === "comment") {
    const [row] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, targetId), eq(comments.status, "visible")))
      .limit(1);
    return !!row;
  }
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  return !!row;
}
