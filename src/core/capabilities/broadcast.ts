/**
 * 实时广播（D7，Laravel Broadcasting 对应物）— 进程内 pub/sub + SSE 下发。
 *
 * 架构（两级扇出）：
 * 1. 进程内直达 — broadcast() 同步遍历本进程订阅者，单进程行为与旧版完全一致；
 * 2. 跨进程扇出 — fire-and-forget 经 Postgres NOTIFY 发布到 `mb_events` 频道
 *    （传输层见 src/core/pg-listen.ts，专用 LISTEN 连接，不占池），各 worker
 *    进程的监听器收到帧后在**本进程**重放本地分发，不再二次转发，天然无回环。
 *    多进程部署（scripts/cluster-server.mjs fork 多 worker）下，私信等定向
 *    事件因此能触达挂在其他 worker 上的 SSE 长连接。
 *
 * broadcast() 对外签名与同步语义不变；跨进程发布是 best-effort：连接串缺失、
 * DB 抖动、帧序列化失败都只降级为进程内广播（至多 warn 一次），不阻塞请求路径。
 * 如需多机部署再引入 Redis pub/sub，本接口不变。
 *
 * 事件形状：{ type: string; payload?: unknown; ts: number }，type 约定 `<域>.<动作>`
 * （message.created / unread.changed / ext.<id>.<event>）。
 */
import { ensurePgListener, notifyMbEvent, pgOrigin } from "@/core/pg-listen";

export interface BroadcastEvent {
  type: string;
  payload?: unknown;
  ts: number;
}

type Subscriber = (event: BroadcastEvent) => void;

interface Channel {
  userId: string | null; // null = 全站广播
  subs: Set<Subscriber>;
}

const g = globalThis as unknown as { __mbBroadcastChannels?: Channel[] };
const channels: Channel[] = (g.__mbBroadcastChannels ??= []);

/**
 * 跨进程 NOTIFY 帧。Postgres 对 NOTIFY payload 有 8000 字节硬上限，序列化后
 * 超过 ~7000 字节时只发事件头（targets/type/ts）不带 payload —— 订阅端仍能
 * 分发事件头，前端消费方大多只看 type 触发刷新（如重拉未读数），缺 payload
 * 可接受；取舍是"保证送达事件头 > 保证完整负载"。
 */
interface NotifyFrame {
  /** 生产进程 origin：本进程 LISTEN 会收到自己发的 NOTIFY，据此跳过（本地已投递）。 */
  o: string;
  targets: string[] | "all";
  type: string;
  payload?: unknown;
  ts: number;
}

const NOTIFY_SAFE_LIMIT = 7_000;

/** 本地分发：只投递给本进程订阅者（NOTIFY 回放复用同一逻辑）。 */
function deliverLocally(targets: string[] | "all", event: BroadcastEvent): void {
  for (const ch of channels) {
    if (targets !== "all" && (ch.userId === null || !targets.includes(ch.userId))) continue;
    // 投递隔离：单个订阅者抛异常不阻断同渠道其他订阅者
    for (const sub of ch.subs) {
      try {
        sub(event);
      } catch (err) {
        console.warn("[broadcast] subscriber threw", err);
      }
    }
  }
}

/** 懒启动守卫：首次 subscribe() / 首次跨进程 publish 时挂上监听器。 */
let listenerEnsured = false;
function ensureListener(): void {
  if (listenerEnsured) return;
  listenerEnsured = true;
  ensurePgListener((raw) => {
    try {
      const frame = JSON.parse(raw) as NotifyFrame;
      // 自身 NOTIFY 回环：本进程已在 broadcast() 里同步投递过，跳过防重复
      if (frame.o === pgOrigin()) return;
      deliverLocally(frame.targets, {
        type: frame.type,
        payload: frame.payload,
        ts: frame.ts,
      });
    } catch (err) {
      console.warn("[broadcast] malformed notify frame", err);
    }
  });
}

/** 跨进程发布（fire-and-forget，绝不同步抛出、不阻塞请求路径）。 */
function publishCrossProcess(targets: string[] | "all", event: BroadcastEvent): void {
  ensureListener();
  try {
    const frame: NotifyFrame = {
      o: pgOrigin(),
      targets,
      type: event.type,
      payload: event.payload,
      ts: event.ts,
    };
    let json = JSON.stringify(frame);
    if (Buffer.byteLength(json) > NOTIFY_SAFE_LIMIT) {
      // payload 过大 → 降级为只发事件头（见 NotifyFrame 注释）
      json = JSON.stringify({ o: frame.o, targets: frame.targets, type: frame.type, ts: frame.ts });
      if (Buffer.byteLength(json) > NOTIFY_SAFE_LIMIT) return; // 连事件头都超限（targets 巨大）→ 放弃跨进程
    }
    notifyMbEvent(json);
  } catch (err) {
    // JSON 序列化失败（如环形引用 payload）：本地已投递，跨进程静默放弃
    console.warn("[broadcast] cross-process publish skipped", err);
  }
}

export function broadcast(targets: string[] | "all", event: Omit<BroadcastEvent, "ts">): void {
  const full: BroadcastEvent = { ...event, ts: Date.now() };
  // ① 进程内同步直达（行为与单进程版一致）
  deliverLocally(targets, full);
  // ② 跨进程 best-effort 扇出（内部 async + catch，不等结果）
  publishCrossProcess(targets, full);
}

/** SSE 路由使用：注册订阅者，返回取消函数。首次调用顺带拉起 pg LISTEN。 */
export function subscribe(userId: string | null, sub: Subscriber): () => void {
  ensureListener();
  const ch: Channel = { userId, subs: new Set([sub]) };
  channels.push(ch);
  return () => {
    ch.subs.delete(sub);
    const idx = channels.indexOf(ch);
    if (idx >= 0) channels.splice(idx, 1);
  };
}

/** 活跃连接数（运维观测）。 */
export function activeConnections(): number {
  return channels.reduce((n, c) => n + c.subs.size, 0);
}
