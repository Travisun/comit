import { resolveApiToken } from "@/lib/tokens";
import {
  ensureMcpBootstrapped,
  handleMcpRpc,
  mcpErrorResponse,
  MCP_SERVER_INFO,
} from "@/lib/mcp-transport";
import { mcpTools } from "@/core/plugins/registry";

/**
 * MCP endpoint (/api/mcp) — Model Context Protocol over Streamable HTTP.
 * Auth: `Authorization: Bearer mbt_...` API token (see settings → API/MCP).
 * GET returns a small human-readable info page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureMcpBootstrapped();
  return Response.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    endpoints: "POST JSON-RPC",
    auth: "Authorization: Bearer mbt_<token>",
    protocol: "MCP (JSON-RPC 2.0), stateless — one message per POST",
    tools: mcpTools.size,
  });
}

export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const resolved = token ? await resolveApiToken(token) : null;
  if (!resolved) {
    return mcpErrorResponse(401, null, -32001, "Unauthorized: missing or invalid API token");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpErrorResponse(400, null, -32700, "Parse error: request body is not valid JSON");
  }

  return handleMcpRpc({ userId: resolved.userId, tokenScopes: resolved.scopes }, body);
}
