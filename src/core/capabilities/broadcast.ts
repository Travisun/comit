/**
 * 实时广播（D7，Laravel Broadcasting 对应物）— 进程内 pub/sub + SSE 下发。
 * 单进程部署完全可用；水平扩展时把 publish 换成 Redis pub/sub 即可
 * （订阅端 API 不变）。核心导出 `broadcast()`。
 *
 * 事件形状：{ type: string; payload?: unknown }，type 约定 `<域>.<动作>`
 * （message.created / unread.changed / ext.<id>.<event>）。
 */

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

export function broadcast(targets: string[] | "all", event: Omit<BroadcastEvent, "ts">): void {
  const full: BroadcastEvent = { ...event, ts: Date.now() };
  for (const ch of channels) {
    if (targets !== "all" && (ch.userId === null || !targets.includes(ch.userId))) continue;
    for (const sub of ch.subs) sub(full);
  }
}

/** SSE 路由使用：注册订阅者，返回取消函数。 */
export function subscribe(userId: string | null, sub: Subscriber): () => void {
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
