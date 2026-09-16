"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  SettingsPanelList,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { apiRequest } from "./client";
import type { SettingsData } from "./types";
import { EXTENSION_MANIFESTS } from "@/extensions/_boot/manifests";
import type { SettingFieldDef } from "@/core/capabilities/manifest";

/**
 * 设置 → 扩展 — 已注册扩展的统一设置入口。
 * 每个扩展的表单由其 manifest 的 settingsFields 声明驱动（自动表单）；
 * 需要自定义 UI 的扩展可在 extensions/_boot/registry.ts 覆盖面板。
 */

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: SettingFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );
    case "textarea":
      return (
        <Textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          rows={3}
        />
      );
    case "select":
      return (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === undefined || value === "" ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    default:
      return (
        <Input
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
        />
      );
  }
}

function ExtensionForm({
  id,
  fields,
  initial,
}: {
  id: string;
  fields: SettingFieldDef[];
  initial: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiRequest(`/api/me/ext/${id}/settings`, "PUT", values);
      toast.success("已保存");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key} className="grid gap-1.5">
          {field.type !== "boolean" && <Label htmlFor={`ext-${id}-${field.key}`}>{field.label}</Label>}
          <FieldControl
            field={field}
            value={values[field.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      ))}
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? "保存中…" : "保存"}
      </Button>
    </div>
  );
}

export function ExtensionsPanel({ data }: { data: SettingsData }) {
  if (EXTENSION_MANIFESTS.length === 0) {
    return (
      <SettingsSection>
        <SettingsSectionHeader description="尚未安装任何扩展。" />
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection>
        <SettingsSectionHeader
          description="以下设置由各扩展注册，数据按扩展命名空间隔离存储。"
        />
        <SettingsPanelList>
          {EXTENSION_MANIFESTS.map((m) => (
            <div key={m.id} className="px-4 py-4">
              <div className="mb-3">
                <p className="text-sm font-semibold">
                  {m.title.zh}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {m.id} · v{m.version}
                  </span>
                </p>
                {m.description && <p className="mt-0.5 text-xs text-muted-foreground">{m.description.zh}</p>}
              </div>
              {(m.settingsFields?.length ?? 0) > 0 ? (
                <ExtensionForm
                  id={m.id}
                  fields={m.settingsFields ?? []}
                  initial={data.extSettings[m.id] ?? {}}
                />
              ) : (
                <p className="text-xs text-muted-foreground">此扩展没有可配置项。</p>
              )}
            </div>
          ))}
        </SettingsPanelList>
      </SettingsSection>
    </div>
  );
}
