import { getAuth } from "@/lib/auth/session";
import { logger } from "@/core/logger";
import { subscribe, type BroadcastEvent } from "@/core/capabilities/broadcast";
import { sseSlots } from "@/lib/realtime/sse-counter";
import { loadSseSessionState, sessionStillValid } from "@/lib/realtime/sse-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "sse" });

/**
 * 同一账号并发 SSE 连接上限（跨进程，Redis 计数）：超过则挤占本进程最旧连
 * 接。事件是纯失效提示语义（客户端收到后 invalidate 重拉，见 docs/
 * frontend-architecture.md），挤占旧连接没有数据一致性代价 —— 防止单账号
 * 无限开标签页耗尽 fd/内存。
 *
 * cluster 多 worker 下计数经 Redis 共享（src/lib/realtime/sse-counter.ts）；
 * Redis 不可用时降级进程内计数（保持旧 per-worker 行为）。若超限的槽位持有
 * 者在其它 worker 进程（本地无可挤占连接），新连接直接 204 拒绝（EventSource
 * 停止重连），而非放任超限 —— 全局硬上限优先于"挤占"体验。
 */
const MAX_CONNECTIONS_PER_USER = 5;

/**
 * 重连退避下发（SSE retry 字段）：server 重启/滚动发布时，若不设置，所有
 * 标签页会以浏览器默认 ~3s 间隔齐发重连（thundering herd），放大鉴权 DB 压力。
 */
const RECONNECT_RETRY_MS = 30_000;

/** 心跳周期：25s 保活（< nginx 默认 60s 读超时），同时触发会话复核与槽位续期 */
const HEARTBEAT_MS = 25_000;

interface SseConn {
  userId: string;
  /** 通知客户端「被挤占」（尽力而为，背压时帧会被丢弃） */
  notifyEvicted: () => void;
  /** 完整清理该连接（清心跳、退订、从注册表移除、释放槽位、关流） */
  kill: () => void;
}

const g = globalThis as unknown as { __mbSseConns?: Map<string, Set<SseConn>> };
const conns: Map<string, Set<SseConn>> = (g.__mbSseConns ??= new Map());

/** 会话复核（心跳回调异步执行）：明确失效 → 通知并终止；DB 抖动 → 保留本次连接 */
async function revalidateOrKill(user: { id: string }, sessionId: string, cleanup: () => void, sendInvalidated: () => void): Promise<void> {
  try {
    const state = await loadSseSessionState(user.id, sessionId);
    if (!sessionStillValid(state)) {
      log.info("sse.invalidated", { userId: user.id });
      sendInvalidated();
      cleanup();
    }
  } catch (err) {
    // 复核查询本身失败（DB 瞬时抖动）不掐流：会话失效判定以明确读回的状态为准
    log.warn("sse.revalidate-failed", { userId: user.id, error: String(err) });
  }
}

/**
 * GET /api/realtime/stream — SSE 实时事件流（登录用户）。
 * 心跳 25s 保活 + 会话复核（登出/封禁/邮箱回退即终止）+ 槽位续期。
 * 客户端 EventSource 自动重连。
 */
export async function GET(req: Request) {
  const auth = await getAuth().catch(() => null);
  const user = auth && !auth.pending2fa ? auth.user : null;
  // 会话失效（登出/封禁/过期）、未过 2FA 或邮箱未验证 → 204：WHATWG 规范中
  // 204 让 EventSource 永久停止重连。若返回 401，浏览器会按默认 ~3s 间隔无
  // 限重试 —— 被封禁用户的每个挂开标签页都会永久打 401（鉴权直查 DB）。
  if (!user || !user.emailVerifiedAt) return new Response(null, { status: 204 });
  const sessionId = auth!.sessionId;

  // —— 跨进程槽位：acquire 后若超限，先挤占本进程最旧连接；仍超限（槽位被其
  // 它 worker 的连接持有，本地无从挤占）→ 释放自己的槽并 204 拒绝 ——
  const slots = sseSlots();
  let used: number;
  try {
    used = await slots.acquire(user.id);
  } catch (err) {
    // manager 内置内存降级兜底，理论上不抛；兜底再失败时放行（可用性优先，
    // 进程内注册表仍提供单 worker 硬上限）
    log.warn("sse.slot-acquire-failed", { userId: user.id, error: String(err) });
    used = (conns.get(user.id)?.size ?? 0) + 1;
  }
  {
    const userConns = conns.get(user.id);
    while (used > MAX_CONNECTIONS_PER_USER && userConns && userConns.size > 0) {
      const oldest = userConns.values().next().value;
      if (!oldest) break;
      userConns.delete(oldest);
      oldest.notifyEvicted();
      oldest.kill(); // cleanup 内会 fire-and-forget release（计数随之回落）
      used -= 1;
    }
    if (used > MAX_CONNECTIONS_PER_USER) {
      void slots.release(user.id).catch(() => {});
      log.info("sse.rejected-over-limit", { userId: user.id, used });
      return new Response(null, { status: 204 });
    }
  }

  const encoder = new TextEncoder();
  /** cancel() 触达 start() 作用域内 cleanup 的桥接引用 */
  let requestCleanup: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      /** 槽位只释放一次（挤占路径 kill 与 abort/cancel 竞态都会触达 cleanup） */
      let slotReleased = false;

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

      const heartbeat = setInterval(() => {
        send(JSON.stringify({ type: "ping", ts: Date.now() }));
        // 槽位续期（TTL 兜底崩溃残槽）与会话复核：异步、失败不影响心跳本身
        void slots.renew(user.id).catch(() => {});
        void revalidateOrKill({ id: user.id }, sessionId, cleanup, () =>
          send(JSON.stringify({ type: "realtime.invalidated", ts: Date.now() })),
        );
      }, HEARTBEAT_MS);
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
        if (!slotReleased) {
          slotReleased = true;
          void slots.release(user.id).catch(() => {});
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        log.info("sse.closed", { userId: user.id });
      };

      // —— 注册表：挤占最旧逻辑已在 GET 顶部按跨进程计数完成，这里只做登记 ——
      const conn: SseConn = {
        userId: user.id,
        notifyEvicted: () => send(JSON.stringify({ type: "realtime.evicted", ts: Date.now() })),
        kill: () => cleanup(),
      };
      const userConns = conns.get(user.id) ?? new Set<SseConn>();
      conns.set(user.id, userConns);
      userConns.add(conn);

      // 重连退避：见 RECONNECT_RETRY_MS 注释。必须是流里的第一帧。
      controller.enqueue(encoder.encode(`retry: ${RECONNECT_RETRY_MS}\n\n`));
      send(JSON.stringify({ type: "hello", ts: Date.now() }));

      requestCleanup = cleanup;
      // 建立后首复核：GET 顶部鉴权与此刻之间的登出/封禁窗口极小，但心跳最长
      // 25s 才轮到 —— 首帧后异步补一次，代价是一次主键查询。
      void revalidateOrKill({ id: user.id }, sessionId, cleanup, () =>
        send(JSON.stringify({ type: "realtime.invalidated", ts: Date.now() })),
      );
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
