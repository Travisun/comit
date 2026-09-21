import { z } from "zod";
import { getBoss } from "@/core/queue";
import {ok, jsonBody} from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { AppError } from "@/core/errors";

type Ctx = { params: Promise<{ id: string }> };

const retrySchema = z.object({
  queue: z.string().trim().min(1, "缺少 queue 参数 / Missing queue"),
});

/**
 * E1 队列运维（Horizon 式）：
 *   POST   /api/admin/ops/queue/[id]  body: { queue }  → 重试失败任务
 *   DELETE /api/admin/ops/queue/[id]?queue=<name>      → 删除任务
 */
export async function POST(req: Request, ctx: Ctx) {
  return withPermission(req, "admin.ops", async () => {
    const { id } = await ctx.params;
    const parsed = retrySchema.safeParse(await jsonBody(req).catch(() => ({})));
    if (!parsed.success) {
      throw new AppError("缺少 queue 参数 / Missing queue", 400, "bad_request");
    }
    const queueName = parsed.data.queue;

    const boss = await getBoss();
    const job = await boss.getJobById(queueName, id);
    if (!job) throw new AppError("任务不存在 / Job not found", 404, "not_found");

    // pg-boss 无原生 retry：以原数据重新入队 + 删除失败记录
    await boss.send(job.name, job.data as object);
    await boss.deleteJob(queueName, id);
    return ok({ id, retried: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withPermission(req, "admin.ops", async () => {
    const { id } = await ctx.params;
    const queueName = new URL(req.url).searchParams.get("queue");
    if (!queueName) throw new AppError("缺少 queue 参数 / Missing queue", 400, "bad_request");

    const boss = await getBoss();
    await boss.deleteJob(queueName, id);
    return ok({ id, deleted: true });
  });
}
