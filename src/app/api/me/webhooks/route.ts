import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { conflict, unauthorized } from "@/core/errors";
import {ok, withApi, withUser, jsonBody} from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import {
  ALL_WEBHOOK_EVENT_NAMES,
  MAX_WEBHOOKS_PER_USER,
  newWebhookSecret,
  WEBHOOK_VIEW_COLUMNS,
} from "@/extensions/webhooks/server";
import { webhookUrlDedupKey } from "@/extensions/webhooks/url-policy";
import { parseOrThrow, webhookUrlSchema } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/webhooks — list own webhooks (secret reduced to an 8-char prefix). */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();

    // 列投影（WEBHOOK_VIEW_COLUMNS）：签名私钥根本不被选出 → 结构上不可能回显全文，
    // 只有固定前缀可用于「这是哪把密钥」的辨认
    const rows = await db
      .select(WEBHOOK_VIEW_COLUMNS)
      .from(webhooks)
      .where(eq(webhooks.userId, user.id))
      .orderBy(desc(webhooks.createdAt));

    return ok({
      webhooks: rows,
      availableEvents: ALL_WEBHOOK_EVENT_NAMES,
    });
  });
}

const postSchema = z.object({
  // webhookUrlSchema：仅 https + 拦截本机/内网字面量（与 PATCH 更新接口共用，见 me/_shared）
  url: webhookUrlSchema,
  events: z.array(z.enum(ALL_WEBHOOK_EVENT_NAMES)).min(1, "至少选择一个事件 / Pick at least one event"),
});

/** POST /api/me/webhooks — create a webhook; the signing secret is returned once. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(postSchema, await jsonBody(req).catch(() => null));
    // 限流（按用户，与 PATCH/DELETE/test 同桶）：注册一条端点就等于获得一条
    // 由服务端发起的出站通道 + 后续全部事件的扇出配额，不能免费无限刷。
    await rateLimitBucket("webhook.manage", auth.user.id);

    // 端点数量上限 + 同址去重（一次读取同时服务两个判定）：
    //  - 无上限时任一账号即可把「平台事件 × 端点数 × 失败重试」变成队列放大器；
    //  - 同址重复注册通常是脚本失误或刻意放大同一目标的投递量，直接拒。
    const mine = await db
      .select({ url: webhooks.url })
      .from(webhooks)
      .where(eq(webhooks.userId, auth.user.id));
    if (mine.length >= MAX_WEBHOOKS_PER_USER) {
      throw conflict(
        `Webhook 端点数已达上限（${String(MAX_WEBHOOKS_PER_USER)}）/ Webhook limit reached (${String(MAX_WEBHOOKS_PER_USER)})`,
      );
    }
    const created = webhookUrlDedupKey(body.url);
    if (mine.some((w) => webhookUrlDedupKey(w.url) === created)) {
      throw conflict("该端点已注册 / Endpoint already registered");
    }

    const secret = newWebhookSecret();
    const [row] = await db
      .insert(webhooks)
      .values({
        userId: auth.user.id,
        url: body.url,
        secret,
        events: [...body.events],
        active: true,
      })
      .returning({ id: webhooks.id });

    return ok({ webhook: { id: row.id, secret }, message: "签名密钥仅显示一次 / Secret shown once" });
  });
}
