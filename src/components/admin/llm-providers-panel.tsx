"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Notice,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { Field, SwitchRow } from "@/components/admin/switch-row";
import { postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";

/**
 * LLM 提供商管理面板 — 多提供商多模型配置（lib/llm.ts v2）。
 *
 * - 每个 provider：协议（openai 兼容 / anthropic）、端点、密钥、型号目录、
 *   思考档位、启用开关；apiKey 留空 = 保持服务端已存密钥（hasKey 提示）。
 * - 平台默认模型从 (provider, model) 二元组中选择。
 * - 保存 = PATCH 校验 + POST /api/admin/settings {"llm.providers": value}
 *   （服务端 merge 保留未填写的密钥）。
 */

interface ProviderDraft {
  id: string;
  label: string;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  modelsText: string;
  temperature: string;
  thinking: "off" | "low" | "medium" | "high";
  enabled: boolean;
}

interface DefaultDraft {
  providerId: string;
  model: string;
}

interface LlmProvidersValue {
  providers: ProviderDraft[];
  default: DefaultDraft | null;
}

const THINKING_LABELS: Record<ProviderDraft["thinking"], string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
};

/** 服务端值形状（GET 返回：apiKey 已打码为空 + hasKey 提示）。 */
interface ServerProvidersValue {
  providers?: {
    id: string;
    label: string;
    protocol: "openai" | "anthropic";
    baseUrl: string;
    apiKey?: string;
    hasKey?: boolean;
    models?: string[];
    temperature?: number;
    thinking?: "off" | "low" | "medium" | "high";
    enabled?: boolean;
  }[];
  default?: DefaultDraft | null;
}

function draftFromValue(value: unknown): LlmProvidersValue {
  const v = (value ?? {}) as ServerProvidersValue;
  const providers: ProviderDraft[] = (v.providers ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    apiKey: "",
    hasKey: Boolean(p.hasKey),
    modelsText: (p.models ?? []).join(", "),
    temperature: p.temperature !== undefined ? String(p.temperature) : "",
    thinking: p.thinking ?? "off",
    enabled: p.enabled ?? true,
  }));
  return { providers, default: v.default ?? null };
}

export function LlmProvidersPanel({ value }: { value: unknown }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LlmProvidersValue>(() => draftFromValue(value as LlmProvidersValue));
  const [error, setError] = useState<string | null>(null);

  const enabledProviders = draft.providers.filter((p) => p.enabled);
  const defaultOptions = useMemo(
    () =>
      enabledProviders.flatMap((p) =>
        p.modelsText
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
          .map((model) => ({ providerId: p.id, model, key: `${p.id}::${model}` })),
      ),
    [enabledProviders],
  );

  function updateProvider(i: number, patch: Partial<ProviderDraft>) {
    setDraft((prev) => ({
      ...prev,
      providers: prev.providers.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  }

  function addProvider() {
    setDraft((prev) => {
      const id = `llm-${Date.now().toString(36)}`;
      return {
        ...prev,
        providers: [
          ...prev.providers,
          {
            id,
            label: "新提供商",
            protocol: "openai",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "",
            hasKey: false,
            modelsText: "",
            temperature: "",
            thinking: "off",
            enabled: true,
          },
        ],
      };
    });
  }

  function removeProvider(i: number) {
    setDraft((prev) => {
      const removed = prev.providers[i];
      const providers = prev.providers.filter((_, idx) => idx !== i);
      const def =
        prev.default && removed && prev.default.providerId === removed.id ? null : prev.default;
      return { providers, default: def };
    });
  }

  function validate(): string | null {
    for (const p of draft.providers) {
      if (!p.id.trim()) return "提供商 ID 不能为空";
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(p.id.trim())) return "提供商 ID 仅允许字母、数字、-、_";
      if (!p.baseUrl.trim()) return `${p.label || p.id} 的端点不能为空`;
      if (!p.enabled) continue;
      const models = p.modelsText.split(",").map((m) => m.trim()).filter(Boolean);
      if (models.length === 0) return `${p.label || p.id} 至少配置一个模型`;
      if (!p.hasKey && !p.apiKey.trim()) return `${p.label || p.id} 未配置 API Key`;
    }
    return null;
  }

  const [saving, setSaving] = useState(false);

  async function save() {
    const err = validate();
    if (err) {
      setError(err);
      toast.error(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        providers: draft.providers.map((p) => ({
          id: p.id.trim(),
          label: p.label.trim() || p.id,
          protocol: p.protocol,
          baseUrl: p.baseUrl.trim(),
          apiKey: p.apiKey, // 空串 = 服务端保留已存密钥
          models: p.modelsText.split(",").map((m) => m.trim()).filter(Boolean),
          ...(p.temperature !== "" ? { temperature: Number(p.temperature) } : {}),
          thinking: p.thinking,
          enabled: p.enabled,
        })),
        default: draft.default,
      };
      await postJson("/api/admin/settings", { entries: { "llm.providers": payload } });
      toast.success("LLM 提供商已保存");
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader description="配置多个大模型提供商（OpenAI 兼容 / Anthropic 协议），支持思考档位与工具调用。审核等平台能力使用此处选定的默认模型。" />
      {error && <Notice tone="warning">{error}</Notice>}

      <div className="space-y-4">
        {draft.providers.map((p, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Input
                value={p.label}
                onChange={(e) => updateProvider(i, { label: e.target.value })}
                placeholder="提供商名称"
                className="max-w-52"
              />
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                <Button variant="ghost" size="sm" onClick={() => removeProvider(i)} aria-label="删除提供商">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">协议</span>
                <div className="flex gap-2">
                  {(["openai", "anthropic"] as const).map((proto) => (
                    <button
                      key={proto}
                      type="button"
                      onClick={() => updateProvider(i, { protocol: proto })}
                      className={
                        p.protocol === proto
                          ? "rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary"
                          : "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      }
                    >
                      {proto === "openai" ? "OpenAI 兼容" : "Anthropic"}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="思考档位（Thinking）">
                <div className="flex gap-1">
                  {(["off", "low", "medium", "high"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateProvider(i, { thinking: t })}
                      className={
                        p.thinking === t
                          ? "rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary"
                          : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      }
                    >
                      {THINKING_LABELS[t]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="mt-3 space-y-3">
              <Field label="API 端点 (Base URL)">
                <Input
                  value={p.baseUrl}
                  onChange={(e) => updateProvider(i, { baseUrl: e.target.value })}
                  placeholder={p.protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
                />
              </Field>
              <Field
                label={p.hasKey ? "API Key（已配置，留空保持不变）" : "API Key"}
              >
                <Input
                  type="password"
                  value={p.apiKey}
                  onChange={(e) => updateProvider(i, { apiKey: e.target.value })}
                  placeholder={p.hasKey ? "••••••••" : "sk-…"}
                />
              </Field>
              <Field label="模型目录（逗号分隔，顺序即回退顺序）">
                <Input
                  value={p.modelsText}
                  onChange={(e) => updateProvider(i, { modelsText: e.target.value })}
                  placeholder={p.protocol === "anthropic" ? "claude-sonnet-4-5, claude-opus-4" : "gpt-4o-mini, o3-mini"}
                />
              </Field>
              <Field label="Temperature（可选，0–2）">
                <Input
                  value={p.temperature}
                  onChange={(e) => updateProvider(i, { temperature: e.target.value.replace(/[^\d.]/g, "") })}
                  placeholder="0.7"
                />
              </Field>
            </div>

            <div className="mt-2">
              <SwitchRow
                label="启用"
                description="关闭后该提供商不参与调用与回退链"
                checked={p.enabled}
                onCheckedChange={(v) => updateProvider(i, { enabled: v })}
                last
              />
            </div>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addProvider}>
          <Plus className="size-4" /> 添加提供商
        </Button>
      </div>

      {/* 平台默认模型 */}
      <div className="mt-6 rounded-lg border border-border p-4">
        <span className="text-sm font-medium">平台默认模型</span>
        <p className="mt-1 text-xs text-muted-foreground">
          审核、扩展等未显式指定模型的 LLM 调用使用该模型（需先启用提供商并填写模型目录）。
        </p>
        <div className="mt-2 flex max-w-md flex-col gap-2">
          {defaultOptions.length === 0 ? (
            <span className="text-xs text-muted-foreground">尚无可用模型 —— 先在上方启用提供商并填写模型目录。</span>
          ) : (
            <>
              <select
                value={
                  draft.default
                    ? `${draft.default.providerId}::${draft.default.model}`
                    : ""
                }
                onChange={(e) => {
                  const [providerId, model] = e.target.value.split("::");
                  setDraft((prev) => ({ ...prev, default: { providerId, model } }));
                }}
                className="h-9 rounded-md border border-border bg-card px-3 text-sm"
              >
                <option value="">未设置</option>
                {defaultOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.providerId} · {o.model}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <SettingsFooter hint="API Key 保存后不再回传明文（仅状态提示）；留空即保持已有密钥。审核等平台能力使用默认模型，协议请求格式由系统按提供商自动适配。">
        <Button onClick={() => void save()} disabled={saving}>
          保存 LLM 提供商
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
