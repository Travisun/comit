import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, webhooks, webhookDeliveries } from "@/db/schema";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { queue } from "@/core/queue";
import type { AppEventPayloads } from "@/core/events";
import {
  type NotificationChannel,
  type NotificationMessage,
  type Plugin,
  type PluginContext,
} from "@/core/plugins/types";

/**
 * Webhook plugin — users subscribe to platform events; deliveries are
 * POSTed as JSON signed with `X-Comit-Signature: t=<ts>,v1=<hmac>`,
 * retried by the queue with exponential backoff.
 *
 * 接收方契约（对照 {@link verifyWebhookSignature}）：
 *   X-Comit-Timestamp: <秒>；X-Comit-Signature: t=<同一秒>,v1=<hex HMAC>；
 *   X-Comit-Event: <事件名>（**仅供参考**：事件名也在签名 body 的 JSON 里，
 *     接收方要信任 body.event，header 可被中间层改写）；
 *   body = 原始字节，签名覆盖 `<ts>.<body>`。
 *   校验：|now − ts| ≤ SIGNATURE_TOLERANCE_SECONDS 且 HMAC 恒定时间相等，
 *   再用 body.deliveryId 去重（防窗口内重放）。
 *
 * ⚠️ 投递作用域（隐私边界）：白名单里的每个事件必须有明确的作用域语义 ——
 * 全局扇出只能投递"公开语义"事件；涉及私密数据的事件走 PARTICIPANT_SCOPED
 * （仅投递给事件当事人自己的 webhook），内部字段走 STRIP_FIELDS 剥离。
 * 新事件入白名单前先回答"这个事件的 payload 可以被任意订阅者看到吗"。
 */
export const WEBHOOK_EVENTS = [
  "post:published",
  "post:liked",
  "comment:created",
  "user:followed",
  "message:created",
  "moderation:review.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** 作用域 resolver：同步取 payload 字段，或异步回查内容表拿作者。 */
type ParticipantResolver = (p: Record<string, unknown>) => string[] | Promise<string[]>;

/**
 * 参与者作用域：返回值非空时，仅投递给 userId ∈ 返回值的 webhook；返回空数组
 * （或解析抛错）= 无人应收到（fail closed，宁可漏投不可错投）。
 *  resolver 允许异步（需查库把 postId → 作者），见下方 moderation 条目。
 * message:created 的 payload 含私信全文 —— 无作用域时任意订阅者会持续
 * 收到全平台所有会话的私信内容（2026-09 审计 P0）。
 * post:liked 的 actorId 同理：获赞名单在本平台**没有**公开枚举接口
 * （/api/likes 只写不读），全局扇出等于把「谁赞了谁」整张关系表推给任意订阅者。
 */
export const PARTICIPANT_SCOPED_EVENTS: Record<string, ParticipantResolver> = {
  "message:created": (p) => userIds(p.senderId, p.receiverId),
  "post:liked": (p) => userIds(p.actorId, p.authorId),
  // 审核结论（approved / 被审对象）属内容当事人与平台之间的状态，不是公开语义：
  // 只投给被审内容（帖子或评论）的作者
  "moderation:review.completed": (p) => resolveReviewSubjectAuthors(p),
};

/** 事件出站前剥离的内部字段（审核理由只应经作者通道/后台可见）。 */
export const STRIPPED_PAYLOAD_FIELDS: Record<string, string[]> = {
  "moderation:review.completed": [
    "reason",
    // by = 命中了关键词库还是 LLM/人工 —— 审核管线内部情报，对第三方通道无必要
    "by",
  ],
};

export const ALL_WEBHOOK_EVENT_NAMES = [...WEBHOOK_EVENTS, "notification"] as const;

/**
 * 单用户端点数上限。每个端点都会对**全平台**事件做扇出（写 deliveries 行 +
 * 入队 + 失败重试 ×4），无上限时任一账号可注册任意数量端点把队列与
 * webhook_deliveries 打成放大器（DoS + 存储增长），故硬封顶。
 */
export const MAX_WEBHOOKS_PER_USER = 20;

/** 连续失败达到该值即自动停用端点（见 core/workers.ts 投递处理器）。 */
export const AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES = 20;

/**
 * 单次投递的队列重试次数（显式传，别依赖 queue.send 的默认值）：
 * worker 每次失败尝试都会 failCount +1，故该值与 AUTO_DISABLE 阈值的关系决定
 * 「一条永久失败的投递最多烧多少次重试」= retryLimit × 端点数，两处改一
 * 处不改会直接放大队列堆积，见 policy.test.ts 的不变量断言。
 */
export const DELIVERY_RETRY_LIMIT = 3;

/**
 * 单事件扇出上限：全平台扇出型事件（post:published 等）每发生一次就要写
 * N 行 deliveries + 入 N 个 job，端点总数无上限时这就是一台放大器
 * （注册上限 × 事件频率 × 重试）。超限时丢弃多出的端点并告警，不抛错。
 */
export const FANOUT_LIMIT_PER_EVENT = 2000;

/** 投递签名/时间戳头（接收方按此契约验签，见 verifyWebhookSignature）。 */
export const SIGNATURE_HEADER = "X-Comit-Signature";
export const TIMESTAMP_HEADER = "X-Comit-Timestamp";
export const EVENT_HEADER = "X-Comit-Event";

/**
 * 时间戳容忍窗（±300s）。Why 取这个量级：
 *  - 过小（如 30s）→ 跨地域时钟偏移 + 队列重试延迟会把合法投递判为非法；
 *  - 过大（如 24h）→ 截获的合法投递可在很长窗口内重放，等于没有防重放。
 *  300s 与 webhook 重试首轮退避同量级，且要求接收方以 body 里的 deliveryId 去重
 *  （见 verifyWebhookSignature 注释）。
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** 只取字符串型 userId（防 payload 被扩展写成对象/数组时误入 IN 条件）。 */
function userIds(...values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length < 64);
}

/**
 * moderation:review.completed 的作用域解析：payload 只带 postId/commentId，
 * 作者需回查内容表。commentId 优先（评论审核时 postId 指向宿主帖子，
 * 帖子作者 ≠ 被审内容作者）。查不到（内容已被硬删）→ 空数组 = 无人收到。
 */
async function resolveReviewSubjectAuthors(p: Record<string, unknown>): Promise<string[]> {
  const commentId = typeof p.commentId === "string" ? p.commentId : null;
  const postId = typeof p.postId === "string" ? p.postId : null;
  if (commentId) {
    const [row] = await db.select({ userId: comments.userId }).from(comments).where(eq(comments.id, commentId)).limit(1);
    return userIds(row?.userId);
  }
  if (postId) {
    const [row] = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, postId)).limit(1);
    return userIds(row?.authorId);
  }
  return [];
}

/**
 * 签名字符串 = `<timestamp>.<原始 body 字节>`（hex HMAC-SHA256）。
 * ⚠️ 调用方必须把**将要发出的同一字符串**同时用于签名与 body —— 若先签名再
 * `JSON.stringify` 一次（键序/空格/Unicode 转义都可能变化），接收方按收到的字节
 * 重算必然不匹配。投递侧的现状是正确的：worker 直接签 `payloadJson` 并把它作为
 * body 发送，中间不再二次序列化。
 * timestamp（秒）纳入签名：无时间戳则整条签名可无限期重放。
 * 事件唯一 id（deliveryId）在 body 内（`{event, data, deliveryId}`），因此同样被签名覆盖。
 */
export function signPayload(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** 签名头：`t=<ts>,v1=<hex>`（时间戳冗余进签名头，接收方单头即可验签，见文件头契约）。 */
export function buildSignatureHeader(timestamp: string, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

/** 解析 `t=…,v1=…` 形式签名头；重复键取首个，缺失记 null。 */
export function parseSignatureHeader(header: string | null | undefined): {
  timestamp: string | null;
  signature: string | null;
} {
  let timestamp: string | null = null;
  let signature: string | null = null;
  for (const part of String(header ?? "").split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t" && timestamp === null) timestamp = value;
    if (key === "v1" && signature === null) signature = value;
  }
  return { timestamp, signature };
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** 定长十六进制的恒定时间比较（timingSafeEqual 要求等长，长度不等必须先判掉）。 */
export function safeSignatureEqual(a: string, b: string): boolean {
  if (!HEX_SHA256.test(a) || !HEX_SHA256.test(b)) return false; // 长度/字符集先固定，避免长度侧信道
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface WebhookSignatureVerifyInput {
  secret: string;
  /** 原始 body 文本，必须与收到的字节完全一致（勿先 JSON.parse 再 stringify） */
  body: string;
  /** `X-Comit-Signature` 头（优先） */
  signatureHeader?: string | null;
  /** `X-Comit-Timestamp` 头（签名头缺 t= 时回落） */
  timestampHeader?: string | null;
  /** 当前秒级时间戳（注入便于测试；默认 Date.now()） */
  nowSeconds?: number;
  /** 容忍窗（秒），默认 SIGNATURE_TOLERANCE_SECONDS */
  toleranceSeconds?: number;
}

/**
 * 参考验签实现（接收方契约的权威定义，同时供本仓库未来的入站回调复用）：
 *  1. 时间戳必须是纯数字秒且在 ±tolerance 内 → 关掉无限期重放窗口；
 *  2. 以**原始 body 字节**重算 HMAC，恒定时间比较；
 *  3. 通过 `t=` 参与签名，攻击者改时间戳即令签名失效。
 * 防重放的幂等部分不在这里（无状态函数做不到）：接收方需以 body.deliveryId（或
 * messageId）做已处理集合去重，窗口内重复投递才会被真正接受两次。
 * 任何一步不满足返回 false（不区分失败原因，避免给探测者反馈）。
 */
export function verifyWebhookSignature(input: WebhookSignatureVerifyInput): boolean {
  const parsed = parseSignatureHeader(input.signatureHeader);
  const signature = parsed.signature;
  // 时间戳来源优先级：签名头内 t= （被签名覆盖）→ 独立时间戳头（兜底，
  // 兼容只发 X-Comit-Timestamp 的旧客户端）。两者都不满足格式即拒绝。
  const candidates = [parsed.timestamp, typeof input.timestampHeader === "string" ? input.timestampHeader.trim() : null];
  const timestamp = candidates.find((v): v is string => typeof v === "string" && /^\d+$/.test(v));
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > tolerance) return false;
  return safeSignatureEqual(signPayload(input.secret, input.body, timestamp), signature);
}

/** core/http-client 的 ssrfGuard 抛错统一以 `SSRF guard:` 开头（node 侧 ERR_INVALID_URL 同族）。 */
const EGRESS_POLICY_ERROR = /^(SSRF guard:|ERR_INVALID_URL)/i;
/** 出口策略拦截的统一落库文案（不含任何目标主机/解析结果）。 */
const EGRESS_BLOCKED_TEXT = "delivery blocked by egress policy (SSRF guard)";

/**
 * 投递失败原因落库前的收敛：
 *  - 出口策略类错误 → 固定文案（原文含解析到的内网地址，而这一列会进运维可见面，
 *    没必要把内网拓扑抄一份出去，那也是「借测试按钮探测内网」的残余 oracle 面）；
 *  - 其余错误压成单行并截断 500 字符（防下游整页 HTML 错误页灌库）。
 */
export function sanitizeDeliveryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (isPermanentDeliveryError(err)) return EGRESS_BLOCKED_TEXT;
  return raw.replace(/[\r\n]+/g, " ").slice(0, 500);
}

/**
 * 出口策略拦截（SSRF / 目标地址非法）属永久性失败：同一规则下重投必然再被拦，
 * 白烧 worker 预算，且反复解析同一内网目标会形成可被观察的时序信号
 * → worker 据此停用端点、不把 job 交回队列。
 * undici 会把 node 错误码挂在 `cause` 上（TypeError: Failed to parse URL …），
 * 故 cause 也要判一次。
 */
export function isPermanentDeliveryError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  if (EGRESS_POLICY_ERROR.test(raw)) return true;
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  if (!cause) return false;
  return cause.code === "ERR_INVALID_URL" || EGRESS_POLICY_ERROR.test(String(cause.message ?? ""));
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}


/**
 * 端点列表的 secret 投影（隐私边界）：webhooks.secret 是签名私钥，任何"列表/详情"
 * 出口都只允许回显固定前缀（whsec_ + 少量字符）。这里把列选择收成一个函数，
 * 是为了让 route 与页面 SSR 结构上**无法**把整把密钥带进响应 —— 新增读取点时
 * 也照抄这个投影，不要退回 `db.select().from(webhooks)`。
 * （投递扇出与创建/轮换密钥的路径需要明文，那是写路径，不在此列。）
 */
export const WEBHOOK_VIEW_COLUMNS = {
  id: webhooks.id,
  url: webhooks.url,
  events: webhooks.events,
  active: webhooks.active,
  lastStatus: webhooks.lastStatus,
  lastDeliveryAt: webhooks.lastDeliveryAt,
  failCount: webhooks.failCount,
  secretPrefix: sql<string>`left(${webhooks.secret}, 8)`.as("secret_prefix"),
  createdAt: webhooks.createdAt,
} as const;

/** Queue a signed delivery for one webhook. */
async function enqueueDelivery(hook: typeof webhooks.$inferSelect, event: string, payload: Record<string, unknown>) {
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ webhookId: hook.id, event, payload })
    .returning({ id: webhookDeliveries.id });
  // queue.send 返回 null（或抛错）= 队列不可用 → 直接置 failed，避免 delivery 永久 pending
  const jobId = await queue
    .send(
      "webhook.deliver",
      {
        webhookId: hook.id,
        event,
        payloadJson: JSON.stringify({ event, data: payload, deliveryId: delivery.id }),
        deliveryId: delivery.id,
      },
      { retryLimit: DELIVERY_RETRY_LIMIT },
    )
    .catch((err: unknown) => {
      console.error("[webhooks] queue.send failed:", err);
      return null;
    });
  if (jobId === null) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", error: "queue unavailable: enqueue failed" })
      .where(eq(webhookDeliveries.id, delivery.id));
  }
}

/**
 * 出站前的 payload 准备：按 STRIPPED_PAYLOAD_FIELDS 剥离内部字段。
 * 浅拷贝后删除，绝不改动原对象（notifications 等同一条事件的其它监听器共享它）。
 * 导出只为让"字段过滤"可单测——生产路径仍由 dispatchWebhooks 调用。
 */
export function prepareOutboundPayload(event: string, raw: Record<string, unknown>): Record<string, unknown> {
  const strip = STRIPPED_PAYLOAD_FIELDS[event];
  if (!strip?.length) return raw;
  const outbound = { ...raw };
  for (const f of strip) delete outbound[f];
  return outbound;
}

/** Fan a domain event out to every subscribed, active webhook（含作用域策略，见文件头）。 */
async function dispatchWebhooks<K extends keyof AppEventPayloads>(
  event: K,
  payload: AppEventPayloads[K],
): Promise<void> {
  const raw = payload as unknown as Record<string, unknown>;
  // 内部字段剥离（reason / by 等审核情报不出站）
  const outbound = prepareOutboundPayload(event as string, raw);
  // 参与者作用域：仅当事人自己的 webhook 收到
  const scoped = PARTICIPANT_SCOPED_EVENTS[event as string];
  let participants: string[] | null = null;
  if (scoped) {
    try {
      participants = await scoped(raw);
    } catch (err) {
      // resolver 抛错（内容表查询失败等）→ fail closed：一条都不投。
      // 反向选择（当作无作用域全局扇出）等于把私密事件泄露给全体订阅者。
      console.error(`[webhooks] participant resolver failed for "${String(event)}", dropping delivery:`, err);
      return;
    }
    if (participants.length === 0) return; // 无当事人（防御）→ 无人应收到
  }

  const conditions = [
    eq(webhooks.active, true),
    sql`${webhooks.events} @> ${JSON.stringify([event])}::jsonb`,
  ];
  if (participants) conditions.push(inArray(webhooks.userId, participants));
  const hooks = await db
    .select()
    .from(webhooks)
    .where(and(...conditions))
    .orderBy(asc(webhooks.createdAt))
    // 扇出预算：单事件最多投递这么多端点（订阅热度异常/刷端点时的兜底闸门）。
    // 按创建时间稳定排序后再截断，保证"被截掉的是谁"可预测；超出部分丢弃并告警。
    .limit(FANOUT_LIMIT_PER_EVENT + 1);
  if (hooks.length > FANOUT_LIMIT_PER_EVENT) {
    console.warn(
      `[webhooks] fan-out cap (${FANOUT_LIMIT_PER_EVENT}) reached for "${String(event)}"; ${String(
        hooks.length - FANOUT_LIMIT_PER_EVENT,
      )} hook(s) skipped`,
    );
    hooks.length = FANOUT_LIMIT_PER_EVENT;
  }
  for (const hook of hooks) {
    await enqueueDelivery(hook, event as string, outbound);
  }
}

/** 'webhook' notification channel — notifications become webhook deliveries. */
export const webhookChannel: NotificationChannel = {
  id: "webhook",
  label: { zh: "Webhook", en: "Webhook" },
  async send(userId: string, message: NotificationMessage) {
    const hooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.userId, userId),
          eq(webhooks.active, true),
          sql`${webhooks.events} @> ${JSON.stringify(["notification"])}::jsonb`,
        ),
      );
    for (const hook of hooks) {
      await enqueueDelivery(hook, "notification", message as unknown as Record<string, unknown>);
    }
  },
};

const plugin: Plugin = {
  name: "webhooks",
  description: "User webhook subscriptions with HMAC-signed delivery",
  version: "1.0.0",
  register(ctx: PluginContext) {
    ctx.registerChannel(webhookChannel);
    for (const event of WEBHOOK_EVENTS) {
      ctx.events.on(event, (payload) => {
        void dispatchWebhooks(event, payload);
      });
    }
  },
};

export default plugin;
