import { getBoss } from "@/core/queue";
import { ok, withAdmin } from "@/lib/http";
import { AppError } from "@/core/errors";

type Ctx = { params: Promise<{ id: string }> };

/**
 * E1 队列运维（Horizon 式）：
 *   POST   /api/admin/ops/queue/[id]  body: { queue }  → 重试失败任务
 *   DELETE /api/admin/ops/queue/[id]?queue=<name>      → 删除任务
 */
export async function POST(req: Request, ctx: Ctx) {
  return withAdmin(req, async () => {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { queue?: string };
    const queueName = body.queue;
    if (!queueName) throw new AppError("缺少 queue 参数 / Missing queue", 400, "bad_request");

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
  return withAdmin(req, async () => {
    const { id } = await ctx.params;
    const queueName = new URL(req.url).searchParams.get("queue");
    if (!queueName) throw new AppError("缺少 queue 参数 / Missing queue", 400, "bad_request");

    const boss = await getBoss();
    await boss.deleteJob(queueName, id);
    return ok({ id, deleted: true });
  });
}
