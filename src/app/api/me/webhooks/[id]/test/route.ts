import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { notFound, ok, withUser } from "@/lib/http";
import { queue } from "@/core/queue";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { parseOrThrow } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/**
 * POST /api/me/webhooks/[id]/test — queue a signed `ping` test delivery
 * (recorded in webhook_deliveries like any other event).
 *
 * 这是一条「用户驱动的服务端出站请求」通道，因此按 SSRF/oracle 面治理：
 *  1. 必须走 webhook.deliver worker —— 那条路径上 ssrfGuard + IP pin 是唯一权威
 *     出口校验，这里绝不自己 fetch（绕过防线）；
 *  2. 按用户限速（webhook.test 桶）：否则可用作任意 URL 的高频内网探测器；
 *  3. 响应只回 deliveryId，**不回显目标响应体/状态/耗时**：接收端返回什么、
 *     连得上连不上，都只能通过 deliveries 表由 admin 侧观察，用户侧无 oracle。
 *     （异步投递本身即切断同步回显路径。）
 */
export async function POST(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);
    await rateLimitBucket("webhook.test", auth.user.id);

    const [hook] = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, auth.user.id)))
      .limit(1);
    if (!hook) throw notFound("Webhook 不存在 / Webhook not found");

    const payload = { event: "ping", data: { message: "webhook test" } };
    // deliveries 行的 id 必须由数据库生成后回读：先前用 randomUUID() 另造一个 id
    // 传给队列，worker 按该 id UPDATE 命中 0 行 → 测试投递永远停在 pending，
    // 真实结果无处可查（也掩盖了投递被 SSRF 拦掉这类信号）。
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: hook.id,
        event: "ping",
        payload,
        status: "pending",
      })
      .returning({ id: webhookDeliveries.id });
    // event 列与 body 里的 event 必须同名（原来写 "notification"，接收方按 body
    // 判定为 ping，后台按列筛选 notification 又会把测试投递混进通知转发）
    const payloadJson = JSON.stringify({ ...payload, deliveryId: delivery.id });
    await queue.send(
      "webhook.deliver",
      {
        webhookId: hook.id,
        event: "ping",
        payloadJson,
        deliveryId: delivery.id,
      },
      // 测试投递只试 1 次重投：它的用途是"通不通"，不需要正式事件的重试预算
      { retryLimit: 1 },
    );

    return ok({ deliveryId: delivery.id });
  });
}
