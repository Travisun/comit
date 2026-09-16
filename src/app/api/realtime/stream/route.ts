import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/core/logger";
import { toErrorResponse, unauthorized } from "@/core/errors";
import { subscribe, type BroadcastEvent } from "@/core/capabilities/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "sse" });

/**
 * GET /api/realtime/stream — SSE 实时事件流（登录用户）。
 * 心跳 25s 保活；客户端 EventSource 自动重连。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  // 建连前的 401 仍以 Response 返回，但统一为 { error, code } JSON envelope
  if (!user) return toErrorResponse(unauthorized());

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };

      send(JSON.stringify({ type: "hello", ts: Date.now() }));
      const heartbeat = setInterval(() => send(JSON.stringify({ type: "ping", ts: Date.now() })), 25_000);

      const unsubscribe = subscribe(user.id, (event: BroadcastEvent) => send(JSON.stringify(event)));
      // 幂等清理：abort（客户端断开）与 cancel（服务端取消流）都要走到，
      // 否则 heartbeat 定时器会随每次连接泄漏。cancel 必须是 underlying source
      // 的同级方法（Streams 规范），不能通过 start() 的返回值挂接。
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        log.info("sse.closed", { userId: user.id });
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
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
