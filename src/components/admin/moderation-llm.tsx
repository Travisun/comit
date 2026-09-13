"use client";

import { useEffect, useState } from "react";
import { Play, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Separator, Switch } from "@/components/ui/primitives";
import { Field } from "@/components/admin/switch-row";
import { api } from "@/components/admin/client";
import { cn } from "@/lib/utils";

interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
}

interface SettingsResponse {
  entries: Record<string, unknown> & {
    "moderation.reviewMode": "off" | "llm" | "manual";
    "moderation.keywordsEnabled": boolean;
    "moderation.llmFailMode": "open" | "closed";
    "moderation.llm": LlmConfig & { hasKey: boolean };
  };
}

const REVIEW_MODES = [
  { value: "off", label: "直接发布", hint: "不审核，发布即上线" },
  { value: "llm", label: "LLM 审核", hint: "模型通过后自动发布，否则进队列" },
  { value: "manual", label: "人工审核", hint: "全部进入待审队列" },
] as const;

/** LLM 审核设置 + 测试审核。 */
export function ModerationLlmTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [reviewMode, setReviewMode] = useState<"off" | "llm" | "manual">("off");
  const [keywordsEnabled, setKeywordsEnabled] = useState(true);
  const [failMode, setFailMode] = useState<"open" | "closed">("open");
  const [llm, setLlm] = useState<LlmConfig>({
    baseURL: "",
    apiKey: "",
    model: "",
    temperature: 0,
    prompt: "",
  });
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    api<SettingsResponse>("/api/admin/settings")
      .then((d) => {
        const e = d.entries;
        setReviewMode(e["moderation.reviewMode"]);
        setKeywordsEnabled(Boolean(e["moderation.keywordsEnabled"]));
        setFailMode(e["moderation.llmFailMode"]);
        const cfg = e["moderation.llm"];
        setHasKey(Boolean(cfg?.hasKey));
        setLlm({
          baseURL: cfg?.baseURL ?? "",
          apiKey: "",
          model: cfg?.model ?? "",
          temperature: cfg?.temperature ?? 0,
          prompt: cfg?.prompt ?? "",
        });
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ hasKey: boolean }>("/api/admin/moderation/llm", {
        method: "POST",
        body: JSON.stringify({ reviewMode, keywordsEnabled, failMode, llm }),
      });
      setHasKey(res.hasKey);
      setLlm((prev) => ({ ...prev, apiKey: "" }));
      toast.success("审核配置已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api<{ result: { approved: boolean; score?: number; reason?: string } | null }>(
        "/api/admin/moderation/llm/test",
        { method: "POST", body: JSON.stringify({ text: testText }) },
      );
      if (res.result === null) {
        setTestResult("未获得结果：未配置 API Key，或调用失败（详见服务端日志）。");
      } else {
        setTestResult(JSON.stringify(res.result, null, 2));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return null;

  return (
    <div className="space-y-4">
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
          <h3 className="text-sm font-semibold">LLM 接口</h3>
          <p className="text-xs text-muted-foreground">
            OpenAI 兼容接口。API Key {hasKey ? "已配置，留空表示保留原值" : "未配置"}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="API Base URL">
            <Input
              value={llm.baseURL}
              onChange={(e) => setLlm({ ...llm, baseURL: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
          <Field label="API Key">
            <Input
              type="password"
              value={llm.apiKey}
              onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
              placeholder={hasKey ? "••••••（留空保留原值）" : "sk-…"}
              autoComplete="new-password"
            />
          </Field>
          <Field label="模型">
            <Input
              value={llm.model}
              onChange={(e) => setLlm({ ...llm, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </Field>
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
            <Button onClick={save} disabled={saving}>
              <Save className="size-4" />
              {saving ? "保存中…" : "保存审核配置"}
            </Button>
          </div>
        </div>
      </div>

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
        <Button variant="outline" onClick={runTest} disabled={testing || !testText.trim()}>
          <Play className="size-4" />
          {testing ? "审核中…" : "测试审核"}
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
