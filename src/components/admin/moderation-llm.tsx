"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Separator, Switch } from "@/components/ui/primitives";
import { EmptyState } from "@/components/admin/bits";
import { Field } from "@/components/admin/switch-row";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";

interface LlmConfig {
  /** 空 = 平台默认模型 */
  providerId: string;
  model: string;
  temperature: number;
  prompt: string;
}

/* -------------------------------- schema --------------------------------- */

// GET /api/admin/settings 的 moderation 白名单键（apiKey 被服务端脱敏为 hasKey）
const llmEntrySchema = z.object({
  providerId: z.string().optional(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  prompt: z.string().optional(),
  hasKey: z.boolean().optional(),
});

/** 系统提供商目录（站点设置 → AI 模型），用于审核专用模型下拉 */
const providersEntrySchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        models: z.array(z.string()),
        enabled: z.boolean(),
        hasKey: z.boolean().optional(),
      }),
    )
    .optional(),
  default: z
    .object({ providerId: z.string(), model: z.string() })
    .nullable()
    .optional(),
});

const adminSettingsSchema = z.object({
  entries: z.object({
    "moderation.reviewMode": z.enum(["off", "llm", "manual"]),
    "moderation.keywordsEnabled": z.boolean(),
    "moderation.llmFailMode": z.enum(["open", "closed"]),
    "moderation.llm": llmEntrySchema,
    "llm.providers": providersEntrySchema.optional(),
  }),
});

type AdminSettingsEntries = z.infer<typeof adminSettingsSchema>["entries"];

type LlmTestResult = { approved: boolean; score?: number; reason?: string } | null;

const REVIEW_MODES = [
  { value: "off", label: "直接发布", hint: "不审核，发布即上线" },
  { value: "llm", label: "LLM 审核", hint: "模型通过后自动发布，否则进队列" },
  { value: "manual", label: "人工审核", hint: "全部进入待审队列" },
] as const;

/** LLM 审核设置 + 测试审核。 */
export function ModerationLlmTab() {
  // 设置查询 — 配置卡片为 keyed 子组件：data 版本变化（首次到达/保存失效重取）
  // 时以服务端权威值重新播种；测试面板的输入/结果留在高层，不随重播种丢失
  const settingsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminSettings(),
      url: "/api/admin/settings",
      schema: adminSettingsSchema,
    }),
  );
  const loading = settingsQ.isLoading;
  const error = settingsQ.error instanceof Error ? settingsQ.error.message : null;

  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // 测试审核 — 结果是临时产物进本地 state；保持原静默语义：
  // result 为 null 走内联降级文案而非 toast，失败时默认 toast 服务端错误
  const testMutation = useApiMutation(
    (text: string) => postJson<{ result: LlmTestResult }>("/api/admin/moderation/llm/test", { text }),
    {
      refresh: false,
      onSuccess: (res) => {
        setTestResult(
          res.result === null
            ? "未获得结果：未配置 LLM 提供商或模型（站点设置 → AI 模型），或调用失败（详见服务端日志）。"
            : JSON.stringify(res.result, null, 2),
        );
      },
    },
  );

  if (loading) return null;

  if (error && !settingsQ.data) {
    return <EmptyState title="加载失败" hint={error} />;
  }
  if (!settingsQ.data) return null;

  return (
    <div className="space-y-4">
      <LlmConfigForm key={settingsQ.dataUpdatedAt} seed={settingsQ.data.entries} />

      <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)] space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">测试审核</h3>
          <p className="text-xs text-muted-foreground">用一段文本实际调用一次 LLM 审核，查看返回结果</p>
        </div>
        <Textarea
          rows={3}
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="输入要测试的文本内容…"
        />
        <Button
          variant="outline"
          onClick={() => {
            setTestResult(null);
            void testMutation.mutate(testText);
          }}
          disabled={testMutation.pending || !testText.trim()}
        >
          <Play className="size-4" />
          {testMutation.pending ? "审核中…" : "测试审核"}
        </Button>
        {testResult ? (
          <pre className="overflow-x-auto rounded-lg bg-[var(--muted)] p-3 text-xs leading-relaxed">
            {testResult}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/** 审核策略 + 审核模型两张卡片 — 编辑态从 seed 初始化（不再用 effect 同步）。 */
function LlmConfigForm({ seed }: { seed: AdminSettingsEntries }) {
  const cfg = seed["moderation.llm"];
  const providers = seed["llm.providers"];
  const [reviewMode, setReviewMode] = useState<"off" | "llm" | "manual">(seed["moderation.reviewMode"]);
  const [keywordsEnabled, setKeywordsEnabled] = useState(Boolean(seed["moderation.keywordsEnabled"]));
  const [failMode, setFailMode] = useState<"open" | "closed">(seed["moderation.llmFailMode"]);
  const [llm, setLlm] = useState<LlmConfig>(() => ({
    providerId: cfg?.providerId ?? "",
    model: cfg?.model ?? "",
    temperature: cfg?.temperature ?? 0,
    prompt: cfg?.prompt ?? "",
  }));

  // 可选模型 = 平台默认 + 各启用提供商的模型目录（与站点设置 AI 模型同源）
  const enabledProviders = (providers?.providers ?? []).filter((p) => p.enabled && p.models.length > 0);
  const modelValue = llm.providerId ? `${llm.providerId}::${llm.model}` : "";
  const hasUsableModel = enabledProviders.length > 0 || Boolean(cfg?.hasKey);

  // 保存审核配置 — 成功失效设置键（重取服务端权威值）
  const saveMutation = useApiMutation(
    (payload: {
      reviewMode: "off" | "llm" | "manual";
      keywordsEnabled: boolean;
      failMode: "open" | "closed";
      llm: LlmConfig;
    }) => postJson<{ ok: boolean }>("/api/admin/moderation/llm", payload),
    {
      refresh: false,
      invalidate: [queryKeys.adminSettings()],
      successToast: "审核配置已保存",
    },
  );

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)] space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">发布审核策略</h3>
          <p className="text-xs text-muted-foreground">决定新内容提交后的流转方式</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {REVIEW_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setReviewMode(m.value)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                reviewMode === m.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/60",
              )}
            >
              <span className="text-sm font-semibold">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">关键词前置检测</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              命中「禁止」级关键词直接拒绝；命中「警告」级转人工审核
            </p>
          </div>
          <Switch checked={keywordsEnabled} onCheckedChange={setKeywordsEnabled} aria-label="关键词检测" />
        </div>

        <Separator />

        <div className="flex flex-col gap-1.5 sm:max-w-56">
          <Label>LLM 失败策略</Label>
          <select
            value={failMode}
            onChange={(e) => setFailMode(e.target.value as "open" | "closed")}
            className="h-[30px] rounded-md border-0 bg-card px-2 text-sm text-[color:var(--text-body)] outline-none shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)] focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)] px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="LLM 失败策略"
          >
            <option value="open">fail-open：服务不可用时放行</option>
            <option value="closed">fail-closed：服务不可用时进队列</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)] space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">审核模型</h3>
          <p className="text-xs text-muted-foreground">
            复用系统 LLM 能力：接口与密钥在「站点设置 → AI 模型」统一维护，这里只选择审核用的模型。
          </p>
        </div>
        {hasUsableModel ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:max-w-96 sm:col-span-2">
              <Label>审核模型</Label>
              <select
                value={modelValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) setLlm((prev) => ({ ...prev, providerId: "", model: "" }));
                  else {
                    const [providerId, model] = v.split("::");
                    setLlm((prev) => ({ ...prev, providerId, model }));
                  }
                }}
                className="h-[34px] rounded-md border-0 bg-card px-2.5 text-sm text-[color:var(--text-body)] outline-none shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)] focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)]"
                aria-label="审核模型"
              >
                <option value="">
                  平台默认模型
                  {providers?.default ? `（${providers.default.providerId} · ${providers.default.model}）` : ""}
                </option>
                {enabledProviders.flatMap((p) =>
                  p.models.map((m) => (
                    <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                      {p.label} — {m}
                    </option>
                  )),
                )}
              </select>
            </div>
            <Field label="Temperature">
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={llm.temperature}
                onChange={(e) => setLlm({ ...llm, temperature: Number(e.target.value) })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="审核提示词" hint="模型需返回 JSON：{approved, score, reason}">
                <Textarea
                  rows={4}
                  value={llm.prompt}
                  onChange={(e) => setLlm({ ...llm, prompt: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => void saveMutation.mutate({ reviewMode, keywordsEnabled, failMode, llm })} disabled={saveMutation.pending}>
                <Save className="size-4" />
                {saveMutation.pending ? "保存中…" : "保存审核配置"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-[var(--muted)]/40 px-4 py-3 text-sm text-muted-foreground">
            尚未配置可用的 LLM 提供商 —— 前往
            <a href="/admin/settings" className="mx-1 font-medium text-primary hover:underline">
              站点设置 → AI 模型
            </a>
            添加提供商与模型后，再回到这里选择审核模型。
          </div>
        )}
      </div>
    </>
  );
}
