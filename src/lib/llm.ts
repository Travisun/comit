import { z } from "zod";
import { getSetting } from "@/lib/settings";
import { httpRequest } from "@/core/http-client";

/**
 * LLM 能力 v2 — 多提供商多模型（platform capability）。
 *
 * 协议适配（两种业界标准）：
 *  - "openai"    — OpenAI Chat Completions（也兼容所有 openai 形态端点：
 *                  DeepSeek / Moonshot / OpenRouter / vLLM / Ollama 等），
 *                  支持 tools / tool_choice / response_format(json_object) /
 *                  reasoning_effort 思考档位（o 系与 gpt-5 系）。
 *  - "anthropic" — Anthropic Messages（system 顶层字段、content blocks、
 *                  tools 为 input_schema 形态、tool_result 回传块、
 *                  thinking: {type:"enabled", budget_tokens} 思考模式 ——
 *                  思考开启时强制 temperature=1 且 max_tokens > 预算）。
 *
 * 配置：setting 键 `llm.providers`（admin 设置页维护），结构见
 * LlmSettings；未配置时回退到旧版单提供商 `moderation.llm`（向后兼容）。
 *
 * 调用入口：
 *  - llmComplete(opts): Promise<LlmResult>  —— 全量结果（文本/思考/工具调用/用量）
 *  - llmChat(opts): Promise<string>          —— 兼容旧签名，返回纯文本
 * 协议请求/响应映射为纯函数（buildXxx/parseXxx），单测覆盖见 llm.test.ts。
 */

/* ------------------------------ 配置模型 ------------------------------ */

export type LlmProtocol = "openai" | "anthropic";
export type LlmThinkingLevel = "off" | "low" | "medium" | "high";

export interface LlmProviderConfig {
  id: string;
  label: string;
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string;
  /** 该提供商可用型号（admin 手动维护；模型回退链按此顺序） */
  models: string[];
  temperature?: number;
  thinking?: LlmThinkingLevel;
  enabled: boolean;
}

export interface LlmSettings {
  providers: LlmProviderConfig[];
  /** 平台默认模型（扩展与审核等未显式指定时使用） */
  default: { providerId: string; model: string } | null;
}

export const llmProvidersValueSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(1).max(80),
        protocol: z.enum(["openai", "anthropic"]),
        baseUrl: z.string().trim().min(1).max(300),
        apiKey: z.string().max(400).default(""),
        models: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
        temperature: z.number().min(0).max(2).optional(),
        thinking: z.enum(["off", "low", "medium", "high"]).optional(),
        enabled: z.boolean(),
      }),
    )
    .max(20),
  default: z
    .object({ providerId: z.string(), model: z.string() })
    .nullable()
    .default(null),
});

/* ------------------------------ 消息与工具 ------------------------------ */

export interface LlmTool {
  name: string;
  description?: string;
  /** JSON Schema（openai parameters / anthropic input_schema 同形） */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** JSON 字符串（与两家协议的线格式一致） */
  arguments: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  /** assistant：本轮发起的工具调用（协议适配见 buildXxx） */
  toolCalls?: LlmToolCall[];
  /** tool：本条结果对应的调用 id */
  toolCallId?: string;
  /** tool：被调用的工具名 */
  name?: string;
}

export interface LlmResult {
  text: string;
  /** 思考过程（协议支持时）：openai reasoning_content / anthropic thinking 块 */
  reasoning?: string;
  toolCalls: LlmToolCall[];
  usage?: { input: number; output: number };
  providerId: string;
  model: string;
}

export interface LlmCompleteOptions {
  messages: LlmMessage[];
  /** 指定提供商（缺省用平台默认；再缺省回退旧版 moderation.llm） */
  providerId?: string;
  /** 模型 id；缺省用提供商 models[0] 或平台默认 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** true ⇒ 强制 JSON 响应（openai: response_format；anthropic: system 追加约束 + 客户端提取） */
  json?: boolean;
  /** json_schema 约束输出（openai 协议；优先级高于 json，RLCD 审核服务要求） */
  responseFormat?: "json_object" | "json_schema";
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** 思考档位；缺省读提供商配置 thinking */
  thinking?: LlmThinkingLevel;
  tools?: LlmTool[];
  toolChoice?: "auto" | "none" | { name: string };
}

/* --------------------------- 请求/响应映射（纯函数） --------------------------- */

/** 思考档位 → anthropic budget_tokens。 */
const ANTHROPIC_THINKING_BUDGET: Record<Exclude<LlmThinkingLevel, "off">, number> = {
  low: 4_096,
  medium: 10_240,
  high: 20_480,
};

export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** OpenAI 协议请求构造。 */
export function buildOpenAiRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: LlmCompleteOptions,
): WireRequest {
  const messages = opts.messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content ?? "" };
  });

  const body: Record<string, unknown> = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) {
    // o 系 / gpt-5 系用 max_completion_tokens（max_tokens 已弃用且会 400）
    body[model.startsWith("o") || model.startsWith("gpt-5") ? "max_completion_tokens" : "max_tokens"] =
      opts.maxTokens;
  }
  if (opts.responseFormat === "json_schema" && opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
    };
  } else if (opts.json) body.response_format = { type: "json_object" };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  if (opts.toolChoice) {
    body.tool_choice =
      typeof opts.toolChoice === "string"
        ? opts.toolChoice
        : { type: "function", function: { name: opts.toolChoice.name } };
  }
  if (opts.thinking && opts.thinking !== "off") body.reasoning_effort = opts.thinking;

  return {
    url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  };
}

interface OpenAiWireMessage {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
}

/** OpenAI 协议响应解析。 */
export function parseOpenAiResponse(data: unknown, model: string, providerId: string): LlmResult {
  const d = data as {
    choices?: {
      message?: OpenAiWireMessage;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = d.choices?.[0]?.message;
  if (!msg) throw new Error("LLM 响应缺少 choices[0].message");
  return {
    text: msg.content ?? "",
    reasoning: msg.reasoning_content ?? undefined,
    toolCalls: (msg.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments ?? "{}",
    })),
    usage: d.usage
      ? { input: d.usage.prompt_tokens ?? 0, output: d.usage.completion_tokens ?? 0 }
      : undefined,
    providerId,
    model,
  };
}

/** Anthropic 协议请求构造。 */
export function buildAnthropicRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  opts: LlmCompleteOptions,
  defaultThinking: LlmThinkingLevel = "off",
): WireRequest {
  // system 独立为顶层字段（协议约束）；json 模式追加约束（anthropic 无 response_format）
  const systemParts = opts.messages.filter((m) => m.role === "system").map((m) => m.content ?? "");
  if (opts.json) systemParts.push("Respond with a single valid JSON object and nothing else.");
  const chatMessages = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content ?? "" }],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const blocks: Record<string, unknown>[] = m.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: safeJsonParse(tc.arguments),
        }));
        if (m.content) blocks.unshift({ type: "text", text: m.content });
        return { role: "assistant", content: blocks };
      }
      return { role: m.role, content: m.content ?? "" };
    });

  const thinking: LlmThinkingLevel = opts.thinking ?? defaultThinking;
  const budget = thinking !== "off" ? ANTHROPIC_THINKING_BUDGET[thinking] : 0;
  const maxTokens = Math.max(opts.maxTokens ?? 4_096, budget ? budget + 1_024 : 0);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: chatMessages,
  };
  if (systemParts.length) body.system = systemParts.join("\n\n");
  if (thinking !== "off") {
    // 协议约束：思考开启时 temperature 必须为 1（或缺省）且 max_tokens > 预算
    body.thinking = { type: "enabled", budget_tokens: budget };
    body.temperature = 1;
  } else if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  if (opts.toolChoice) {
    if (typeof opts.toolChoice === "string") {
      if (opts.toolChoice === "auto") body.tool_choice = { type: "auto" };
      // "none"：anthropic 无该值，省略工具集即等效
    } else {
      body.tool_choice = { type: "tool", name: opts.toolChoice.name };
    }
  }

  return {
    url: `${baseUrl.replace(/\/$/, "")}/v1/messages`,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
  };
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Anthropic 协议响应解析。 */
export function parseAnthropicResponse(data: unknown, model: string, providerId: string): LlmResult {
  const d = data as {
    content?: AnthropicContentBlock[];
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  const blocks = d.content ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const reasoning = blocks.find((b) => b.type === "thinking")?.thinking;
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b, i) => ({
      id: b.id ?? `toolu_${i}`,
      name: b.name ?? "",
      arguments: JSON.stringify(b.input ?? {}),
    }));
  return {
    text,
    reasoning: reasoning || undefined,
    toolCalls,
    usage: d.usage
      ? { input: d.usage.input_tokens ?? 0, output: d.usage.output_tokens ?? 0 }
      : undefined,
    providerId,
    model,
  };
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text || "{}");
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 从混合文本中提取首个平衡 JSON 对象（anthropic json 模式的客户端兜底）。 */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/* ------------------------------ 配置解析 ------------------------------ */

const llmConfigSchema = z
  .object({
    baseURL: z.string(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().optional(),
  })
  .passthrough();

async function getLlmSettings(): Promise<LlmSettings> {
  const raw = await getSetting("llm.providers");
  const parsed = llmProvidersValueSchema.safeParse(raw);
  return parsed.success ? (parsed.data as LlmSettings) : { providers: [], default: null };
}

/** 旧版单提供商（moderation.llm）— llm.providers 未配置时的兼容回退。 */
async function getLegacyProvider(): Promise<LlmProviderConfig | null> {
  const cfg = await getSetting("moderation.llm");
  const legacy = llmConfigSchema.safeParse(cfg);
  if (!legacy.success || !legacy.data.apiKey) return null;
  return {
    id: "legacy",
    label: "旧版单提供商",
    protocol: "openai",
    baseUrl: legacy.data.baseURL,
    apiKey: legacy.data.apiKey,
    models: legacy.data.model ? [legacy.data.model] : [],
    temperature: legacy.data.temperature,
    enabled: true,
  };
}

async function resolveProvider(
  providerId?: string,
): Promise<{ provider: LlmProviderConfig; model?: string } | null> {
  const settings = await getLlmSettings();
  const pick = (p: LlmProviderConfig, model?: string) =>
    p.enabled ? { provider: p, model: model ?? p.models[0] } : null;

  if (providerId) {
    const p = settings.providers.find((x) => x.id === providerId);
    if (p) return pick(p);
  }
  const defaultModel = settings.default;
  if (defaultModel) {
    const p = settings.providers.find((x) => x.id === defaultModel.providerId);
    if (p) return pick(p, defaultModel.model);
  }
  const legacy = await getLegacyProvider();
  if (legacy) return pick(legacy);
  return null;
}

/* ------------------------------ 模型目录 / 提示词 ------------------------------ */

const g = globalThis as unknown as {
  __mbLlmModels?: Map<string, LlmModelDef>;
  __mbLlmPrompts?: Map<string, string>;
};
const models: Map<string, LlmModelDef> = (g.__mbLlmModels ??= new Map());
const prompts: Map<string, string> = (g.__mbLlmPrompts ??= new Map());

export interface LlmModelDef {
  id: string;
  label: string;
  registeredBy?: string;
}

export function registerLlmModel(def: LlmModelDef): void {
  models.set(def.id, def);
}

export function listLlmModels(): LlmModelDef[] {
  return [...models.values()];
}

export function registerPrompt(name: string, template: string): void {
  prompts.set(name, template);
}

/** `{{var}}` 插值；name 未注册时按字面量模板处理。 */
export function renderPrompt(nameOrTemplate: string, vars: Record<string, string> = {}): string {
  const template = prompts.get(nameOrTemplate) ?? nameOrTemplate;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** 查询提供商可用型号（openai /models；anthropic /v1/models）。 */
export async function listRemoteModels(providerId?: string): Promise<string[]> {
  const resolved = await resolveProvider(providerId);
  const legacy = resolved
    ? null
    : ((await getLegacyProvider()) as LlmProviderConfig | null);
  const p = (resolved?.provider ?? legacy) as LlmProviderConfig | null;
  if (!p) return [];

  if (p.protocol === "anthropic") {
    const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers: { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  }
  const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${p.apiKey}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}

/* ------------------------------ 调用入口 ------------------------------ */

/** 标准化 chat 调用（全量结果）。协议分发 + 模型回退链（限同提供商 models 列表）。 */
export async function llmComplete(opts: LlmCompleteOptions): Promise<LlmResult> {
  const resolved = await resolveProvider(opts.providerId);
  if (!resolved) throw new Error("LLM 未配置 / LLM is not configured");
  const { provider } = resolved;

  // 回退链：请求模型 → 提供商目录序（限同提供商，杜绝跨供应商误调用）
  const candidates: string[] = [];
  for (const m of [opts.model, ...provider.models]) {
    if (m && !candidates.includes(m)) candidates.push(m);
  }
  if (candidates.length === 0) throw new Error("LLM 未配置模型 / No model configured");

  const wireOpts: LlmCompleteOptions = { ...opts, thinking: opts.thinking ?? provider.thinking };

  let lastErr: unknown = null;
  for (const model of candidates) {
    const wire =
      provider.protocol === "anthropic"
        ? buildAnthropicRequest(
            provider.baseUrl,
            provider.apiKey,
            model,
            wireOpts,
            provider.thinking ?? "off",
          )
        : buildOpenAiRequest(provider.baseUrl, provider.apiKey, model, wireOpts);
    try {
      const res = await httpRequest<unknown>(wire.url, {
        method: "POST",
        timeoutMs: wireOpts.timeoutMs ?? 30_000,
        retries: 0,
        label: `llm:${provider.id}:${model}`,
        headers: wire.headers,
        json: wire.body,
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status} (model=${model})`);
      const data: unknown = await res.json();
      const result =
        provider.protocol === "anthropic"
          ? parseAnthropicResponse(data, model, provider.id)
          : parseOpenAiResponse(data, model, provider.id);
      if (wireOpts.json && !result.toolCalls.length) {
        const extracted = extractJson(result.text);
        if (extracted) result.text = extracted;
      }
      return result;
    } catch (err) {
      lastErr = err;
      // 超时/网络中断不回退（回退链掩盖真实故障没有意义）
      if (err instanceof Error && err.name === "AbortError") throw err;
      console.warn(`[llm] model "${model}" 不可用，尝试回退：`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM 调用失败");
}

/**
 * 兼容旧签名 — 返回纯文本（moderation 等既有调用点零改动）。
 * 默认开启 json 提取兜底（旧版行为）。
 */
export async function llmChat(opts: LlmChatOptions): Promise<string> {
  const result = await llmComplete({
    messages: opts.messages,
    providerId: opts.providerId,
    model: opts.model,
    thinking: opts.thinking,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    json: opts.responseFormat ? undefined : (opts.json ?? true),
    responseFormat: opts.responseFormat,
    jsonSchema: opts.jsonSchema,
  });
  return result.text;
}

/** 是否有可用的 LLM（显式 providerId 可解析且模型目录非空，或平台默认/旧版回退可用）。 */
export async function llmAvailable(providerId?: string): Promise<boolean> {
  const resolved = await resolveProvider(providerId);
  if (!resolved) return false;
  return Boolean(resolved.model) || resolved.provider.models.length > 0;
}

/** 兼容旧版选项类型（v1 LlmChatOptions：messages/model/temperature/json…）。 */
export type LlmChatOptions = LlmCompleteOptions;
