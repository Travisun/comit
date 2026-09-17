import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildAnthropicRequest,
  buildOpenAiRequest,
  extractJson,
  parseAnthropicResponse,
  parseOpenAiResponse,
  type LlmCompleteOptions,
} from "@/lib/llm";

/**
 * LLM 协议完备性审计单测：两种标准协议（OpenAI Chat Completions /
 * Anthropic Messages）的请求构造与响应解析映射，覆盖思考模式与工具调用。
 */

const baseOpts: LlmCompleteOptions = {
  messages: [
    { role: "system", content: "你是助手" },
    { role: "user", content: "你好" },
  ],
};

/* ------------------------------ OpenAI ------------------------------ */

describe("buildOpenAiRequest", () => {
  it("基础映射：system/user 消息 + Bearer 头 + /chat/completions", () => {
    const wire = buildOpenAiRequest("https://api.openai.com/v1", "sk-test", "gpt-4o-mini", baseOpts);
    expect(wire.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(wire.headers.Authorization).toBe("Bearer sk-test");
    expect(wire.body.model).toBe("gpt-4o-mini");
    expect(wire.body.messages).toEqual([
      { role: "system", content: "你是助手" },
      { role: "user", content: "你好" },
    ]);
  });

  it("json 模式 → response_format json_object", () => {
    const wire = buildOpenAiRequest("https://x/v1", "k", "gpt-4o-mini", { ...baseOpts, json: true });
    expect(wire.body.response_format).toEqual({ type: "json_object" });
  });

  it("思考模式 → reasoning_effort（o/gpt-5 系用 max_completion_tokens）", () => {
    const o3 = buildOpenAiRequest("https://x/v1", "k", "o3", { ...baseOpts, thinking: "high", maxTokens: 4_096 });
    expect(o3.body.reasoning_effort).toBe("high");
    expect(o3.body.max_completion_tokens).toBe(4_096);
    expect(o3.body.max_tokens).toBeUndefined();

    const gpt5 = buildOpenAiRequest("https://x/v1", "k", "gpt-5-mini", { ...baseOpts, maxTokens: 1_000 });
    expect(gpt5.body.max_completion_tokens).toBe(1_000);

    const gpt4o = buildOpenAiRequest("https://x/v1", "k", "gpt-4o-mini", { ...baseOpts, maxTokens: 1_000 });
    expect(gpt4o.body.max_tokens).toBe(1_000);
    expect(gpt4o.body.max_completion_tokens).toBeUndefined();
  });

  it("工具调用：tools 声明 / tool_choice 定向 / assistant.tool_calls 与 tool 结果双向映射", () => {
    const opts: LlmCompleteOptions = {
      messages: [
        { role: "user", content: "查天气" },
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_weather", arguments: '{"city":"北京"}' }] },
        { role: "tool", toolCallId: "call_1", name: "get_weather", content: '{"temp":25}' },
      ],
      tools: [{ name: "get_weather", description: "查天气", parameters: { type: "object" } }],
      toolChoice: { name: "get_weather" },
    };
    const wire = buildOpenAiRequest("https://x/v1", "k", "gpt-4o-mini", opts);
    expect(wire.body.tools).toEqual([
      { type: "function", function: { name: "get_weather", description: "查天气", parameters: { type: "object" } } },
    ]);
    expect(wire.body.tool_choice).toEqual({ type: "function", function: { name: "get_weather" } });
    const msgs = wire.body.messages as Record<string, unknown>[];
    expect(msgs[1]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"北京"}' } }],
    });
    expect(msgs[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"temp":25}' });
  });
});

describe("parseOpenAiResponse", () => {
  it("文本/用量/reasoning_content/tool_calls 解析", () => {
    const r = parseOpenAiResponse(
      {
        choices: [
          {
            message: {
              content: "结果",
              reasoning_content: "思考中…",
              tool_calls: [{ id: "call_9", function: { name: "fn", arguments: '{"x":1}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      },
      "gpt-4o-mini",
      "p1",
    );
    expect(r.text).toBe("结果");
    expect(r.reasoning).toBe("思考中…");
    expect(r.toolCalls).toEqual([{ id: "call_9", name: "fn", arguments: '{"x":1}' }]);
    expect(r.usage).toEqual({ input: 11, output: 7 });
  });
});

/* ------------------------------ Anthropic ------------------------------ */

describe("buildAnthropicRequest", () => {
  it("system 提为顶层字段 + x-api-key / anthropic-version 头 + /v1/messages", () => {
    const wire = buildAnthropicRequest("https://api.anthropic.com", "ak-test", "claude-sonnet-4-5", baseOpts);
    expect(wire.url).toBe("https://api.anthropic.com/v1/messages");
    expect(wire.headers["x-api-key"]).toBe("ak-test");
    expect(wire.headers["anthropic-version"]).toBe("2023-06-01");
    expect(wire.body.system).toBe("你是助手");
    const msgs = wire.body.messages as { role: string; content: string }[];
    expect(msgs).toEqual([{ role: "user", content: "你好" }]);
    expect(wire.body.max_tokens).toBe(4_096); // 协议必填
  });

  it("思考模式：thinking.enabled + budget + temperature=1 + max_tokens > budget", () => {
    const wire = buildAnthropicRequest(
      "https://api.anthropic.com",
      "ak",
      "claude-sonnet-4-5",
      { ...baseOpts, thinking: "medium", maxTokens: 1_000 },
      "off",
    );
    expect(wire.body.thinking).toEqual({ type: "enabled", budget_tokens: 10_240 });
    expect(wire.body.temperature).toBe(1);
    expect(wire.body.max_tokens).toBe(11_264); // budget + 1024
  });

  it("提供商默认思考档位生效", () => {
    const wire = buildAnthropicRequest(
      "https://api.anthropic.com",
      "ak",
      "claude-sonnet-4-5",
      { ...baseOpts, thinking: "high" },
      "high",
    );
    expect(wire.body.thinking).toEqual({ type: "enabled", budget_tokens: 20_480 });
  });

  it("工具调用：input_schema 形态 / tool_choice / tool_use 与 tool_result 块映射", () => {
    const opts: LlmCompleteOptions = {
      messages: [
        { role: "user", content: "查天气" },
        { role: "assistant", toolCalls: [{ id: "toolu_1", name: "get_weather", arguments: '{"city":"北京"}' }] },
        { role: "tool", toolCallId: "toolu_1", name: "get_weather", content: '{"temp":25}' },
      ],
      tools: [{ name: "get_weather", description: "查天气", parameters: { type: "object" } }],
      toolChoice: { name: "get_weather" },
    };
    const wire = buildAnthropicRequest("https://api.anthropic.com", "ak", "claude-sonnet-4-5", opts);
    expect(wire.body.tools).toEqual([
      { name: "get_weather", description: "查天气", input_schema: { type: "object" } },
    ]);
    expect(wire.body.tool_choice).toEqual({ type: "tool", name: "get_weather" });
    const msgs = wire.body.messages as { role: string; content: unknown }[];
    expect(msgs[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "北京" } }],
    });
    expect(msgs[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":25}' }],
    });
  });
});

describe("parseAnthropicResponse", () => {
  it("text/thinking/tool_use 内容块与 usage 解析", () => {
    const r = parseAnthropicResponse(
      {
        content: [
          { type: "thinking", thinking: "推理过程" },
          { type: "text", text: "结论" },
          { type: "tool_use", id: "toolu_9", name: "fn", input: { x: 1 } },
        ],
        usage: { input_tokens: 20, output_tokens: 9 },
        stop_reason: "tool_use",
      },
      "claude-sonnet-4-5",
      "p2",
    );
    expect(r.text).toBe("结论");
    expect(r.reasoning).toBe("推理过程");
    expect(r.toolCalls).toEqual([{ id: "toolu_9", name: "fn", arguments: '{"x":1}' }]);
    expect(r.usage).toEqual({ input: 20, output: 9 });
  });
});

/* ------------------------------ JSON 提取 / 兼容回退 ------------------------------ */

describe("extractJson（anthropic json 模式客户端兜底）", () => {
  it("首个平衡 JSON 对象", () => {
    expect(extractJson('前言 {"approved":true} 后缀')).toBe('{"approved":true}');
    expect(extractJson('{"a":{"b":1}}')).toBe('{"a":{"b":1}}');
  });

  it("字符串内的花括号不破坏配对", () => {
    expect(extractJson('{"s":"}"}')).toBe('{"s":"}"}');
  });

  it("无 JSON → null", () => {
    expect(extractJson("纯文本")).toBeNull();
  });
});

describe("旧版单提供商回退（moderation.llm → openai 协议）", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("未配置 llm.providers 时回退旧配置并发送 openai 形态请求", async () => {
    vi.doMock("@/lib/settings", async () => {
      const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
      return {
        ...actual,
        getSetting: vi.fn(async (key: string) =>
          key === "moderation.llm"
            ? { baseURL: "https://legacy.example/v1", apiKey: "legacy-key", model: "legacy-model", temperature: 0 }
            : actual.SETTINGS_DEFAULTS[key as keyof typeof actual.SETTINGS_DEFAULTS],
        ),
      };
    });
    const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    vi.doMock("@/core/http-client", async () => ({
      httpRequest: vi.fn(async (url: string, opts: { headers: Record<string, string>; json: unknown }) => {
        sent.push({ url, headers: opts.headers, body: opts.json });
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
          text: async () => "",
        };
      }),
    }));

    const { llmComplete } = await import("@/lib/llm");
    const r = await llmComplete({ messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("ok");
    expect(r.providerId).toBe("legacy");
    expect(sent[0].url).toBe("https://legacy.example/v1/chat/completions");
    expect(sent[0].headers.Authorization).toBe("Bearer legacy-key");
    expect((sent[0].body as { model: string }).model).toBe("legacy-model");
  });
});
