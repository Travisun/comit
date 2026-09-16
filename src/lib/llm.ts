import { getSetting } from "@/lib/settings";
import { httpRequest } from "@/core/http-client";

/**
 * LLM 能力 — 平台级大模型调用标准化（OpenAI-compatible chat completions）。
 *
 *  - 模型目录：内置 + 扩展注册（`registerLlmModel`），`listLlmModels()` 供
 *    设置页/扩展查询可用型号；
 *  - 远端型号：`listRemoteModels()` 查询供应商 /v1/models；
 *  - 提示词：`registerPrompt` 注册命名模板，`renderPrompt` 做 {{var}} 插值；
 *  - 调用：`llmChat()` 读取平台 LLM 配置（当前复用 moderation.llm 设置项：
 *    baseURL / apiKey / model / temperature），扩展可覆盖 model。
 */

export interface LlmModelDef {
  /** OpenAI-compatible model id，如 gpt-4o-mini */
  id: string;
  label: string;
  /** 注册来源（内置扩展 id），内置模型为 "platform" */
  registeredBy?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  messages: LlmMessage[];
  /** 缺省用平台配置的默认模型 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** true ⇒ 强制 JSON 响应（response_format） */
  json?: boolean;
}

const g = globalThis as unknown as {
  __mbLlmModels?: Map<string, LlmModelDef>;
  __mbLlmPrompts?: Map<string, string>;
};
const models: Map<string, LlmModelDef> = (g.__mbLlmModels ??= new Map());
const prompts: Map<string, string> = (g.__mbLlmPrompts ??= new Map());

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

interface LlmConfig {
  baseURL: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

async function getConfig(): Promise<LlmConfig> {
  // 平台 LLM 配置当前复用审核设置项（单配置源）；独立配置项在路线图中
  const cfg = await getSetting("moderation.llm");
  return cfg as LlmConfig;
}

/** 查询供应商可用型号（OpenAI-compatible /models）。 */
export async function listRemoteModels(): Promise<string[]> {
  const cfg = await getConfig();
  if (!cfg.apiKey) return [];
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}

/**
 * 标准化 chat completions 调用 — 返回纯文本。
 * 模型回退链：请求模型 → 平台默认 → 已注册的其余型号；「型号不可用」类
 * 失败（400/404/模型报错）自动尝试下一个，超时/断网不回退直接抛出。
 */
export async function llmChat(opts: LlmChatOptions): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.apiKey) throw new Error("LLM 未配置 / LLM is not configured");

  // 构建回退链（去重；platform-default 占位映射为配置的默认模型）
  const candidates: string[] = [];
  for (const m of [
    opts.model,
    cfg.model,
    ...listLlmModels().filter((x) => x.id !== "platform-default").map((x) => x.id),
  ]) {
    if (m && !candidates.includes(m)) candidates.push(m);
  }
  if (candidates.length === 0) throw new Error("LLM 未配置模型 / No model configured");

  let lastErr: unknown = null;
  for (const model of candidates) {
    try {
      const res = await httpRequest<{ choices?: { message?: { content?: string } }[] }>(
        `${cfg.baseURL.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          timeoutMs: opts.timeoutMs ?? 30_000,
          retries: 0,
          label: `llm:${model}`,
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          json: {
            model,
            temperature: opts.temperature ?? cfg.temperature,
            max_tokens: opts.maxTokens,
            messages: opts.messages,
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          },
        },
      );
      if (!res.ok) throw new Error(`LLM HTTP ${res.status} (model=${model})`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
      // 超时/网络中断不回退（重试同模型没有意义且回退链掩盖真实故障）
      if (err instanceof Error && err.name === "AbortError") throw err;
      console.warn(`[llm] model "${model}" 不可用，尝试回退：`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM 调用失败");
}

// 内置模型目录占位：平台默认模型跟随 moderation.llm.model 设置
registerLlmModel({ id: "platform-default", label: "平台默认模型（设置页配置）", registeredBy: "platform" });
