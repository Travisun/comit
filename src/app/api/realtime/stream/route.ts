import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/core/logger";
import { subscribe, type BroadcastEvent } from "@/core/capabilities/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "sse" });

/**
 * 同一账号并发 SSE 连接上限：超过则挤占最旧连接。事件是纯失效提示语义
 * （客户端收到后 invalidate 重拉，见 docs/frontend-architecture.md），挤占
 * 旧连接没有数据一致性代价 —— 防止单账号无限开标签页耗尽 fd/内存。
 */
const MAX_CONNECTIONS_PER_USER = 5;

/**
 * 重连退避下发（SSE retry 字段）：server 重启/滚动发布时，若不设置，所有
 * 标签页会以浏览器默认 ~3s 间隔齐发重连（thundering herd），放大鉴权 DB 压力。
 */
const RECONNECT_RETRY_MS = 30_000;

interface SseConn {
  userId: string;
  /** 通知客户端「被挤占」（尽力而为，背压时帧会被丢弃） */
  notifyEvicted: () => void;
  /** 完整清理该连接（清心跳、退订、从注册表移除、关流） */
  kill: () => void;
}

const g = globalThis as unknown as { __mbSseConns?: Map<string, Set<SseConn>> };
const conns: Map<string, Set<SseConn>> = (g.__mbSseConns ??= new Map());

/**
 * GET /api/realtime/stream — SSE 实时事件流（登录用户）。
 * 心跳 25s 保活（< nginx 默认 60s 读超时）；客户端 EventSource 自动重连。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  // 会话失效（登出/封禁/过期）→ 204：WHATWG 规范中 204 让 EventSource 永久
  // 停止重连。若返回 401，浏览器会按默认 ~3s 间隔无限重试 —— 被封禁用户的
  // 每个挂开标签页都会永久打 401（鉴权直查 DB）。
  if (!user) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  /** cancel() 触达 start() 作用域内 cleanup 的桥接引用 */
  let requestCleanup: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (data: string) => {
        if (closed) return;
        // 背压：desiredSize < 0 = 流内部队列已积压（慢消费者/挂起的标签页）。
        // 事件是失效提示语义，丢弃新事件安全 —— 恢复后由重新查询兜底；
        // 不因此关流，避免半开连接反复重建。
        if (controller.desiredSize !== null && controller.desiredSize < 0) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      const heartbeat = setInterval(() => send(JSON.stringify({ type: "ping", ts: Date.now() })), 25_000);
      const unsubscribe = subscribe(user.id, (event: BroadcastEvent) => send(JSON.stringify(event)));

      // cleanup 的失败路径必须能从 send 触达：enqueue 抛错（流已销毁、
      // abort 尚未触发的竞态窗口）若只置位 closed，会让心跳与订阅者永久泄漏。
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        const set = conns.get(user.id);
        if (set) {
          set.delete(conn);
          if (set.size === 0) conns.delete(user.id);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        log.info("sse.closed", { userId: user.id });
      };

      // —— 每用户并发上限：超过则挤占最旧（Set 保持插入序，最旧 = 首个）——
      const conn: SseConn = {
        userId: user.id,
        notifyEvicted: () => send(JSON.stringify({ type: "realtime.evicted", ts: Date.now() })),
        kill: () => cleanup(),
      };
      const userConns = conns.get(user.id) ?? new Set<SseConn>();
      conns.set(user.id, userConns);
      while (userConns.size >= MAX_CONNECTIONS_PER_USER) {
        const oldest = userConns.values().next().value;
        if (!oldest) break;
        userConns.delete(oldest);
        oldest.notifyEvicted();
        oldest.kill();
      }
      userConns.add(conn);

      // 重连退避：见 RECONNECT_RETRY_MS 注释。必须是流里的第一帧。
      controller.enqueue(encoder.encode(`retry: ${RECONNECT_RETRY_MS}\n\n`));
      send(JSON.stringify({ type: "hello", ts: Date.now() }));

      requestCleanup = cleanup;
      // 幂等清理：abort（客户端断开）与 cancel（服务端取消流）都要走到。
      // cancel 必须是 underlying source 的同级方法（Streams 规范），不能通过
      // start() 的返回值挂接。
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      requestCleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
