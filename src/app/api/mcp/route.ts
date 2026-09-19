import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { resolveApiToken } from "@/lib/tokens";
import {
  ensureMcpBootstrapped,
  handleMcpRpc,
  mcpErrorResponse,
  mcpServerInfo,
} from "@/lib/mcp-transport";
import { mcpTools } from "@/extensions/_boot/server";
import { AppError } from "@/core/errors";
import { assertNotUnderMaintenance } from "@/lib/maintenance";
import { MCP_MUTATING_TOOLS } from "@/extensions/mcp/server";
import { getSetting } from "@/lib/settings";

/**
 * MCP endpoint (/api/mcp) — Model Context Protocol over Streamable HTTP.
 * Auth: `Authorization: Bearer mbt_...` API token (see settings → API/MCP).
 * GET returns a small human-readable info page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureMcpBootstrapped();
  const siteName = await getSetting("site.name");
  const info = mcpServerInfo(siteName);
  return Response.json({
    server: info.name,
    version: info.version,
    endpoints: "POST JSON-RPC",
    auth: "Authorization: Bearer mbt_<token>",
    protocol: "MCP (JSON-RPC 2.0), stateless — one message per POST",
    tools: mcpTools.size,
  });
}

/**
 * 找出 body 中第一个「变更类 tools/call」请求的 id（维护模式拦截点）。
 * 只认带 id 的 request：notification 在 handleMcpRpc 里根本不会执行工具，
 * 无需拦截。变更类名单来自 @/extensions/mcp/server 的 MCP_MUTATING_TOOLS，
 * 与 TOOLS 定义同处维护。混合批次按整体拦截（单消息 per POST 是文档契约，
 * 读 + 写混在一个批次属边缘情况，宁可从严）。
 */
function firstMutatingCallId(body: unknown): string | number | undefined {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const msg = raw as Record<string, unknown>;
    if (msg.method !== "tools/call") continue;
    const id = msg.id;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const params = msg.params;
    if (typeof params !== "object" || params === null) continue;
    const name = (params as Record<string, unknown>).name;
    if (typeof name === "string" && MCP_MUTATING_TOOLS.has(name)) return id;
  }
  return undefined;
}

export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const resolved = token ? await resolveApiToken(token) : null;
  if (!resolved) {
    const siteName = await getSetting("site.name").catch(() => "comit.sh");
    return mcpErrorResponse(
      401,
      null,
      -32001,
      "Unauthorized: missing or invalid API token",
      `${siteName}-mcp`,
    );
  }

  // 限流键 = API token 行 id（稳定、无 PII、不用原始 token 值避免每请求哈希）。
  // 桶 mcp.api 默认 60 req/min：agent 循环调用的合理上限；rateLimitBucket 按
  // 契约超限抛 429、DB 故障内部降级放行 → 这里只需把 429 转成 JSON-RPC 错误格式。
  try {
    await rateLimitBucket("mcp.api", resolved.tokenId);
  } catch {
    return mcpErrorResponse(
      429,
      null,
      -32002,
      "Too many requests: MCP token exceeded 60 requests per minute",
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpErrorResponse(400, null, -32700, "Parse error: request body is not valid JSON");
  }

  // 维护模式接入（复用 lib/maintenance 共享守卫）：本路由不走 withApi/withUser、
  // 不在豁免清单，此前维护期间持 token 仍可 create_article/delete_post 写库。
  // 只对「变更类 tools/call」触发守卫 —— 共享守卫的三条豁免在 JSON-RPC 层的
  // 对应关系：读方法豁免 → 只读工具（list/search/get）与 tools/list、initialize
  // 等元方法完全不经过守卫；管理员豁免（会话）与前缀豁免语义由守卫原样保留，
  // /api/mcp 不属于豁免前缀，token 调用方按普通用户拦截（与 web 侧一致）。
  // 命中时不得裸穿 AppError：按本路由现有错误模式包成 JSON-RPC error envelope
  // （HTTP 503 + code -32003，延续 -32000/-32001/-32002 的服务错误段）。
  const mutatingCallId = firstMutatingCallId(body);
  if (mutatingCallId !== undefined) {
    try {
      await assertNotUnderMaintenance(req);
    } catch (err) {
      return mcpErrorResponse(
        err instanceof AppError ? err.status : 503,
        mutatingCallId,
        -32003,
        err instanceof AppError
          ? err.message
          : "站点维护中，写操作暂不可用 / Site is under maintenance",
      );
    }
  }

  // 站点名进 server instructions（getSettings 双层缓存，无额外查询放大）
  const brandName = await getSetting("site.name");
  return handleMcpRpc({ userId: resolved.userId, tokenScopes: resolved.scopes }, body, { brandName });
}
