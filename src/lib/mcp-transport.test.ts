// 被测模块：src/lib/mcp-transport —— /api/mcp 协议面守卫：
// JSON-RPC 批处理条数上限、工具异常的泄露分级（AppError 可回显、内部错误泛化）、
// token scope 强制、未知工具名回显限长。
// mock 掉扩展 boot 模块（@/extensions/_boot/server 会拉全量插件与 DB），
// 只留一个可编程的 mcpTools 注册表；SDK Server/InMemoryTransport 走真实实现。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/core/errors";
import { mcpTools } from "@/extensions/_boot/server";
import { handleMcpRpc, MCP_BATCH_MAX, type McpAuthContext } from "@/lib/mcp-transport";

vi.mock("@/extensions/_boot/server", () => ({
  // 独立注册表：不 import 真实 @/core/plugins/types（其值导入链会拉起存储能力/DB）
  mcpTools: new Map(),
  bootPlugins: vi.fn(),
}));

const AUTH: McpAuthContext = { userId: "user-1", tokenScopes: ["posts:read"] };

function rpc(id: number, name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

beforeEach(() => {
  mcpTools.clear();
});

describe("批处理上限", () => {
  it(`超过 ${MCP_BATCH_MAX} 条的批次整体拒绝（每条都会新建 Server 对，1MB body 可打包近万条）`, async () => {
    const batch = Array.from({ length: MCP_BATCH_MAX + 1 }, (_, i) => rpc(i + 1, "noop"));
    const res = await handleMcpRpc(AUTH, batch);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/batch exceeds/);
  });

  it("空批次与非法 JSON-RPC 消息按协议错误返回", async () => {
    expect((await handleMcpRpc(AUTH, [])).status).toBe(400);
    expect((await handleMcpRpc(AUTH, { method: "no-jsonrpc" })).status).toBe(400);
  });
});

describe("工具异常的信息泄露分级", () => {
  it("非 AppError（DB/内部异常）不回显原始 message，防 SQL/路径/约束名泄露", async () => {
    mcpTools.set("boom", {
      name: "boom",
      description: "",
      scopes: [],
      inputSchema: {},
      async handler() {
        throw new Error("SECRET insert into posts failed /* gherkin */ at /app/src/db/query.ts:42");
      },
    });
    const res = await handleMcpRpc(AUTH, rpc(1, "boom"));
    const body = (await res.json()) as { result: { content: [{ text: string }]; isError?: boolean } };
    const text = body.result.content[0].text;
    expect(text).toMatch(/internal error/i);
    expect(text).not.toMatch(/SECRET|gherkin|\/app\/src/);
    expect(body.result.isError).toBe(true);
  });

  it("AppError（工具层面向调用方的消息）原样回显", async () => {
    mcpTools.set("guarded", {
      name: "guarded",
      description: "",
      scopes: [],
      inputSchema: {},
      async handler() {
        throw new AppError("post not found or not yours", 404, "not_found");
      },
    });
    const res = await handleMcpRpc(AUTH, rpc(2, "guarded"));
    const body = (await res.json()) as { result: { content: [{ text: string }] } };
    expect(body.result.content[0].text).toBe("Tool error: post not found or not yours");
  });

  it("未知工具名回显限长（不把任意超长输入打进响应）", async () => {
    const res = await handleMcpRpc(AUTH, rpc(3, `x${"y".repeat(300)}`));
    const body = (await res.json()) as { result: { content: [{ text: string }] } };
    expect(body.result.content[0].text.length).toBeLessThan(128);
  });
});

describe("scope 强制", () => {
  it("token 缺少工具所需 scope 时 Forbidden，handler 不执行", async () => {
    let ran = false;
    mcpTools.set("writer", {
      name: "writer",
      description: "",
      scopes: ["posts:write"],
      inputSchema: {},
      async handler() {
        ran = true;
        return {};
      },
    });
    const res = await handleMcpRpc(AUTH, rpc(4, "writer"));
    const body = (await res.json()) as { result: { content: [{ text: string }] } };
    expect(body.result.content[0].text).toMatch(/Forbidden/);
    expect(ran).toBe(false);
  });
});
