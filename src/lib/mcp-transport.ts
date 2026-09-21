import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AppError } from "@/core/errors";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isJSONRPCRequest,
  isJSONRPCNotification,
  isJSONRPCResponse,
  isJSONRPCError,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mcpTools, bootPlugins } from "@/extensions/_boot/server";
import { config } from "@/core/config";

/**
 * MCP over Streamable HTTP (stateless mode), hand-rolled on the SDK:
 * every POST creates a fresh `Server` wired to an `InMemoryTransport`
 * pair; the incoming JSON-RPC message is pushed through the client side
 * of the pair and the single response message is assembled into a plain
 * web Response. Notifications get `202 Accepted` per the spec.
 */

/** 服务名随站点名动态生成（默认站点名 comit.sh ⇒ comit.sh-mcp）。 */
export function mcpServerInfo(siteName: string) {
  return { name: `${siteName}-mcp`, version: "1.0.0" } as const;
}

export interface McpAuthContext {
  userId: string;
  tokenScopes: string[];
}

/** Make sure plugin-registered tools are available even without instrumentation boot. */
export async function ensureMcpBootstrapped(): Promise<void> {
  if (mcpTools.size === 0) await bootPlugins();
}

function createMcpServer(auth: McpAuthContext, brandName?: string): Server {
  const server = new Server(mcpServerInfo(brandName ?? config.app.name), {
    capabilities: { tools: {} },
    instructions: `${brandName ?? config.app.name} content API. Use tools/list to discover tools; every tool call is scoped by the API token's permissions.`,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...mcpTools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const def = mcpTools.get(name);
    if (!def) {
      return {
        // 工具名来自调用方任意输入 —— 回显限长，防超大 name 进响应
        content: [{ type: "text", text: `Unknown tool: ${String(name).slice(0, 64)}` }],
        isError: true,
      };
    }
    // token scopes must cover at least one of the tool's required scopes
    if (def.scopes.length > 0 && !def.scopes.some((s) => auth.tokenScopes.includes(s))) {
      return {
        content: [
          {
            type: "text",
            text: `Forbidden: token scopes [${auth.tokenScopes.join(", ")}] do not cover any of [${def.scopes.join(", ")}]`,
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await def.handler(args ?? {}, {
        userId: auth.userId,
        tokenScopes: auth.tokenScopes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      // 与 toErrorResponse 同套约定：只有 AppError（工具层显式面向调用方的
      // 消息）可以回显；其余（drizzle/PG/插件内部错误）可能带 SQL 片段、
      // 约束名、内部路径 —— 服务端落日志、调用方只见泛化消息。
      if (err instanceof AppError) {
        return {
          content: [{ type: "text", text: `Tool error: ${err.message}` }],
          isError: true,
        };
      }
      console.error(`[mcp] tool "${name}" failed:`, err);
      return {
        content: [{ type: "text", text: "Tool error: internal error (see server logs)" }],
        isError: true,
      };
    }
  });

  return server;
}

function jsonRpcErrorBody(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

export function mcpErrorResponse(
  status: number,
  id: string | number | null,
  code: number,
  message: string,
  realm = "mcp",
): Response {
  return Response.json(jsonRpcErrorBody(id, code, message), {
    status,
    headers: status === 401 ? { "WWW-Authenticate": `Bearer realm="${realm}"` } : undefined,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Push one JSON-RPC request through a fresh in-memory server pair and collect the single response. */
async function processRequest(
  auth: McpAuthContext,
  request: JSONRPCRequest,
  brandName?: string,
): Promise<JSONRPCMessage> {
  const server = createMcpServer(auth, brandName);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const responsePromise = new Promise<JSONRPCMessage>((resolve) => {
    clientTransport.onmessage = (msg) => {
      if ((isJSONRPCResponse(msg) || isJSONRPCError(msg)) && msg.id === request.id) resolve(msg);
    };
  });

  try {
    await server.connect(serverTransport);
    await clientTransport.send(request);
    const response = await Promise.race([
      responsePromise,
      sleep(30_000).then(
        () => jsonRpcErrorBody(request.id, -32000, "MCP server response timeout") as JSONRPCMessage,
      ),
    ]);
    return response;
  } finally {
    await Promise.allSettled([server.close(), clientTransport.close()]);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 单请求批处理条数上限。1MB body 预检挡不住「小而多」的批次：~100 字节的
 * tools/call 一条消息可塞近万条，而 handleMcpRpc 对每条请求都新建一对
 * InMemoryTransport + Server（各带 30s 超时），且限流桶按整个 POST 计 1 次
 * —— 无上限即放大 DoS。超限直接拒绝整批（MCP 新版协议已废弃批处理，
 * 正常客户端不会发多消息数组）。
 */
export const MCP_BATCH_MAX = 32;

/**
 * Handle the parsed body of a POST /api/mcp request. Supports a single
 * JSON-RPC message (request or notification) and legacy batches. Returns:
 *  - `202` for notifications (nothing to answer)
 *  - the JSON-RPC response for requests
 *  - `400` JSON-RPC protocol error for malformed payloads
 */
export async function handleMcpRpc(
  auth: McpAuthContext,
  body: unknown,
  opts: { brandName?: string } = {},
): Promise<Response> {
  await ensureMcpBootstrapped();

  const messages: unknown[] = Array.isArray(body) ? body : [body];
  if (messages.length === 0) {
    return mcpErrorResponse(400, null, -32600, "Invalid Request: empty batch");
  }
  if (messages.length > MCP_BATCH_MAX) {
    return mcpErrorResponse(400, null, -32600, `Invalid Request: batch exceeds ${MCP_BATCH_MAX} messages`);
  }

  const responses: JSONRPCMessage[] = [];
  for (const raw of messages) {
    if (!isPlainObject(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string") {
      const id = isPlainObject(raw) && ("id" in raw) && (typeof raw.id === "string" || typeof raw.id === "number")
        ? raw.id
        : null;
      return mcpErrorResponse(400, id, -32600, "Invalid Request: not a JSON-RPC 2.0 message");
    }
    if (isJSONRPCNotification(raw)) {
      continue; // e.g. notifications/initialized — nothing to answer
    }
    if (!isJSONRPCRequest(raw)) {
      return mcpErrorResponse(400, null, -32600, "Invalid Request");
    }
    responses.push(await processRequest(auth, raw, opts.brandName));
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0], {
    headers: { "Content-Type": "application/json" },
  });
}
