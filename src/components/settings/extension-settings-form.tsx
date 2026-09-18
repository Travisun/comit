"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SwitchRow } from "@/components/admin/switch-row";
import { VirtualSelect } from "@/components/ui/virtual-select";
import { useApiMutation } from "@/lib/query/mutation";
import { apiRequest } from "./client";
import type { SettingFieldDef } from "@/core/capabilities/manifest";

/**
 * 单个扩展的用户级设置表单（manifest settingsFields 驱动的自动表单）。
 * 由 设置 → 扩展 → [扩展] 子页渲染；控件统一平台 UI 原语。
 * 保存走 PUT /api/me/ext/<id>/settings（服务端按 manifest 白名单收敛，
 * 未声明键/非法值一律丢弃，详见 core/capabilities/manifest.ts）。
 */

/** 单个设置字段的标签 + 描述 + 控件渲染（统一平台 UI 原语）。 */
function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SettingFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <Label htmlFor={`ext-${field.key}`} className="text-sm font-medium">
      {field.label}
    </Label>
  );
  const desc = field.description ? (
    <p className="text-xs text-muted-foreground">{field.description}</p>
  ) : null;

  switch (field.type) {
    case "boolean":
      return (
        <div className="space-y-1">
          <SwitchRow
            label={field.label}
            description={field.description}
            checked={Boolean(value)}
            onCheckedChange={onChange as (v: boolean) => void}
            last
          />
        </div>
      );
    case "textarea":
      return (
        <div className="space-y-1.5">
          {label}
          <Textarea
            id={`ext-${field.key}`}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            rows={3}
          />
          {desc}
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          {label}
          <VirtualSelect
            value={String(value ?? "")}
            options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            onChange={onChange as (v: string) => void}
            className="max-w-xs"
          />
          {desc}
        </div>
      );
    case "radio":
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex flex-wrap gap-3">
            {(field.options ?? []).map((o) => (
              <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name={`ext-${field.key}`}
                  value={o.value}
                  checked={String(value ?? "") === o.value}
                  onChange={() => onChange(o.value)}
                  className="accent-[var(--primary)]"
                />
                {o.label}
              </label>
            ))}
          </div>
          {desc}
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            id={`ext-${field.key}`}
            type="number"
            value={value === undefined || value === "" ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className="max-w-32"
          />
          {desc}
        </div>
      );
    default:
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            id={`ext-${field.key}`}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            className="max-w-xs"
          />
          {desc}
        </div>
      );
  }
}

export function ExtensionSettingsForm({
  id,
  fields,
  initial,
}: {
  id: string;
  fields: SettingFieldDef[];
  initial: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);

  const saveMutation = useApiMutation(
    (payload: Record<string, unknown>) => apiRequest(`/api/me/ext/${id}/settings`, "PUT", payload),
    { successToast: "已保存" },
  );

  function save() {
    void saveMutation.mutate(values);
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <FieldRow
            field={field}
            value={values[field.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        </div>
      ))}
      <Button size="sm" onClick={() => save()} disabled={saveMutation.pending}>
        {saveMutation.pending ? "保存中…" : "保存"}
      </Button>
    </div>
  );
}
