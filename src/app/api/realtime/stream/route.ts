import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/core/logger";
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
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
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
      const abort = () => {
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
      req.signal.addEventListener("abort", abort);
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
