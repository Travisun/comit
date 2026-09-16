import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/core/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "client-error" });

const bodySchema = z.object({
  scope: z.string().max(100),
  message: z.string().max(2000),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(2000).optional(),
  path: z.string().max(500).optional(),
  ts: z.number().optional(),
});

/**
 * POST /api/client-errors — 客户端（扩展/错误边界）错误上报落服务端日志。
 * 匿名可写、永不抛出（自身失败静默,绝不能成为新的错误源）。
 */
export async function POST(req: Request) {
  try {
    // 复用全局限流器（自带 MAX_KEYS+prune，无泄漏且键不可由客户端伪造）：
    // 每 IP 每分钟 30 条，超限抛 429 由下方 catch 静默吞掉 → 依旧返回 ok
    rateLimit(`client-error:${clientIp(req)}`, 30, 60_000);

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ ok: true });
    const { scope, message, stack, componentStack, path } = parsed.data;
    log.warn("client.error", { scope, message, stack, componentStack, path });
  } catch {
    /* 永不抛出（含限流 429：超限上报直接丢弃） */
  }
  return NextResponse.json({ ok: true });
}
