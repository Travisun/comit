import Emittery from "emittery";

/**
 * Domain event map — the single source of truth for everything that can be
 * observed on the platform. Plugins/listeners subscribe via `bus.on(name, fn)`.
 * The webhook plugin exposes (a subset of) these as user-subscribable events.
 */
export interface AppEventPayloads {
  "user:registered": {
    userId: string;
    email: string;
    username: string;
    invitedByUserId?: string | null;
  };
  // 登录事件统一走 auth:login（原 user:login 双胞胎无 emit/无监听，已删除）
  "user:followed": { followerId: string; followeeId: string };
  "user:unfollowed": { followerId: string; followeeId: string };

  "post:submitted": {
    postId: string;
    authorId: string;
    title: string;
    needReview: boolean;
  };
  "post:published": {
    postId: string;
    authorId: string;
    slug: string;
    title: string;
    type: "article" | "short";
  };
  "post:approved": { postId: string; authorId: string; moderatorId?: string };
  "post:rejected": {
    postId: string;
    authorId: string;
    reason: string;
    moderatorId?: string;
  };
  "post:liked": { postId: string; actorId: string; authorId: string };
  "post:reposted": { postId: string; actorId: string; authorId: string };
  "comment:created": {
    commentId: string;
    postId: string;
    postAuthorId: string;
    commenterId: string;
    replyToUserId?: string | null;
    excerpt: string;
  };
  // 消费现状：lib/actions/likes.ts 已 emit，但当前无监听者（webhooks 目录亦未含）
  // —— 作为事件目录保留，监听者可随时接入。
  "comment:liked": {
    commentId: string;
    actorId: string;
    commentAuthorId: string;
  };
  "message:read": { userId: string; peerId: string; count: number };
  "message:created": {
    messageId: string;
    senderId: string;
    receiverId: string;
    excerpt: string;
  };
  // auth lifecycle（扩展可订阅：欢迎邮件、风控、外部系统同步…）
  "auth:login": { userId: string; ip?: string };
  "auth:logout": { userId: string | null };
  "auth:registered": { userId: string; email: string; username: string };
  "auth:password.forgot": { userId: string | null; email: string };
  "auth:password.reset": { userId: string };
  "auth:password.changed": { userId: string };

  // 消费现状：当前全库无 emit 方（@mention 功能未落地）—— 作为事件目录保留，
  // 监听者（通知/webhooks）可先行接入。
  "user:mentioned": {
    userIds: string[];
    actorId: string;
    targetType: "post" | "comment";
    targetId: string;
    excerpt: string;
  };

  // internal / system
  "moderation:review.completed": {
    postId: string;
    approved: boolean;
    by: "keyword" | "llm" | "manual";
    reason?: string;
  };
  "media:uploaded": { mediaId: string; userId: string };
  "webhook:delivery.failed": { webhookId: string; event: string; error: string };

  // operations (admin/editor actions — notifications & webhooks hang off these)
  "user:warned": { userId: string; message: string; byAdminId: string };
  "user:banned": {
    userId: string;
    /** ISO timestamp for timed bans, null = permanent */
    bannedUntil: string | null;
    reason: string;
    byAdminId: string;
  };
  "user:unbanned": { userId: string; byAdminId: string };
  "verification:approved": { userId: string; type: string; label: string };
  "verification:rejected": { userId: string; reason: string };
}

export type AppEvents = Emittery<AppEventPayloads>;

// One bus per process, shared across module instances (instrumentation chunk
// vs route chunks) — otherwise listeners registered at boot never receive
// events emitted from route handlers.
const g = globalThis as unknown as { __mbBus?: AppEvents };
export const bus: AppEvents = (g.__mbBus ??= new Emittery());

/** Emit a domain event. All side effects (notifications, webhooks…) hang off this. */
export function emit<K extends keyof AppEventPayloads>(
  name: K,
  payload: AppEventPayloads[K],
): Promise<void> {
  return bus.emit(name, payload).then(() => undefined);
}

/**
 * Emit a domain event **via the queue**（Laravel ShouldQueue listener 语义）：
 * 监听器在 worker 进程异步消费，请求路径零阻塞。监听方式与同步事件一致
 * （event.dispatch worker 把 payloadJson 还原为 bus.emit，见 core/workers.ts）。
 *
 * 设计意图：为「重副作用」监听器提供 off-load 通道 —— emit 方一行换成
 * `await emitQueued(...)`，监听侧零改动即可整体挪进 worker。
 *
 * 当前全库零调用（各 emit 点保持同步 `emit`）的原因（评估结论，勿盲改）：
 *  1) 监听器里真正的慢 I/O 已经二次入队：notifications 扩展 mail 通道渲染后
 *     `queue.send("mail.send")`，nodemailer 实际在 workers.ts 的 mail.send
 *     worker 执行 —— 监听器内只剩轻量 DB 读 + 模板渲染 + 入队，同步成本可控；
 *  2) 在扩展监听器内部改用 emitQueued 重发同一事件会经 event.dispatch worker
 *     还原成 bus.emit 再次触发自身 → 无限循环，需 payload 打标去重，得不偿失；
 *  3) 逐 emit 调用点（api 路由 / lib actions）迁移属业务侧改造，待出现
 *     「监听器过重阻塞请求」的真实事件再逐点接入。
 */
export async function emitQueued<K extends keyof AppEventPayloads>(
  name: K,
  payload: AppEventPayloads[K],
): Promise<string | null> {
  const { queue } = await import("@/core/queue");
  return queue.send("event.dispatch", { name, payloadJson: JSON.stringify(payload) });
}
