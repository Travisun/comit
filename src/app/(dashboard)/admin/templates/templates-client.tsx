"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Monitor, RotateCcw, Save, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Skeleton, Switch } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SectionTabs,
  SettingField,
  SettingRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { EmptyState, FilterChips, PageHeader, TableWrap } from "@/components/admin/bits";
import { api } from "@/components/admin/client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface OverrideState {
  subjectZh?: string;
  subjectEn?: string;
  bodyZh?: string;
  bodyEn?: string;
  enabled: boolean;
}

interface TemplateRow {
  key: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  variables: string[];
  locale: "both";
  override: OverrideState | null;
  customized: boolean;
  enabled: boolean;
}

type TextField = "subjectZh" | "subjectEn" | "bodyZh" | "bodyEn";

interface FormState {
  enabled: boolean;
  subjectZh: string;
  subjectEn: string;
  bodyZh: string;
  bodyEn: string;
}

const EMPTY_FORM: FormState = { enabled: true, subjectZh: "", subjectEn: "", bodyZh: "", bodyEn: "" };

const SUBJECT_FIELDS: { name: TextField; label: string; placeholder: string }[] = [
  { name: "subjectZh", label: "中文主题", placeholder: "留空使用内置主题" },
  { name: "subjectEn", label: "英文主题", placeholder: "Leave empty to use the built-in subject" },
];

const BODY_FIELDS: { name: TextField; label: string }[] = [
  { name: "bodyZh", label: "中文正文（HTML 片段，嵌入品牌布局中）" },
  { name: "bodyEn", label: "英文正文（HTML 片段）" },
];

/** In-site notification keys are generated at the send site — reference table. */
const IN_SITE_KEYS: { key: string; trigger: string }[] = [
  { key: "comment.*", trigger: "评论 / 回复" },
  { key: "follow.*", trigger: "关注" },
  { key: "message.*", trigger: "私信" },
  { key: "moderation.*", trigger: "内容审核结果" },
  { key: "system.ban / system.unban / system.warn", trigger: "封禁 / 解封 / 警告（管理操作）" },
  { key: "verification.approved / verification.rejected", trigger: "认证审核结果" },
];

type AdminTab = "mail" | "insite";

function formFromRow(row: TemplateRow): FormState {
  return {
    enabled: row.enabled,
    subjectZh: row.override?.subjectZh ?? "",
    subjectEn: row.override?.subjectEn ?? "",
    bodyZh: row.override?.bodyZh ?? "",
    bodyEn: row.override?.bodyEn ?? "",
  };
}

function isDirty(form: FormState, row: TemplateRow | undefined): boolean {
  if (!row) return false;
  return (
    form.enabled !== row.enabled ||
    form.subjectZh !== (row.override?.subjectZh ?? "") ||
    form.subjectEn !== (row.override?.subjectEn ?? "") ||
    form.bodyZh !== (row.override?.bodyZh ?? "") ||
    form.bodyEn !== (row.override?.bodyEn ?? "")
  );
}

function TemplateStatusBadge({ row }: { row: TemplateRow }) {
  if (!row.enabled) return <Badge variant="destructive">已停用</Badge>;
  if (row.customized) return <Badge variant="warning">已定制</Badge>;
  return <Badge variant="secondary">默认</Badge>;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function TemplatesClient() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tab, setTab] = useState<AdminTab>("mail");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<"zh" | "en">("zh");
  const [previewNarrow, setPreviewNarrow] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  const selectedKeyRef = useRef<string | null>(null);
  const lastFocused = useRef<TextField>("bodyZh");
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const selected = rows.find((r) => r.key === selectedKey);
  const dirty = isDirty(form, selected);

  const applyRows = useCallback((templates: TemplateRow[], wantKey: string | null) => {
    setRows(templates);
    const row = templates.find((r) => r.key === wantKey) ?? templates[0];
    selectedKeyRef.current = row?.key ?? null;
    setSelectedKey(row?.key ?? null);
    setForm(row ? formFromRow(row) : EMPTY_FORM);
  }, []);

  const load = useCallback(async () => {
    const data = await api<{ templates: TemplateRow[] }>("/api/admin/templates");
    applyRows(data.templates, selectedKeyRef.current);
  }, [applyRows]);

  useEffect(() => {
    load().catch((err: Error) => toast.error(err.message)).finally(() => setLoading(false));
  }, [load]);

  function selectRow(row: TemplateRow) {
    if (row.key === selectedKeyRef.current) return;
    if (dirty && !window.confirm("当前模板有未保存的修改，确定切换吗？")) return;
    selectedKeyRef.current = row.key;
    setSelectedKey(row.key);
    setForm(formFromRow(row));
    setPreview(null);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/admin/templates/${selected.key}`, {
        method: "POST",
        body: JSON.stringify({
          subjectZh: form.subjectZh,
          subjectEn: form.subjectEn,
          bodyZh: form.bodyZh,
          bodyEn: form.bodyEn,
          enabled: form.enabled,
        }),
      });
      toast.success(`模板「${selected.name.zh}」已保存`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!selected) return;
    if (!window.confirm(`确定将「${selected.name.zh}」重置为内置模板吗？`)) return;
    setResetting(true);
    try {
      await api(`/api/admin/templates/${selected.key}/reset`, { method: "POST" });
      toast.success("已重置为默认模板");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function renderPreview(locale: "zh" | "en") {
    if (!selected) return;
    setPreviewOpen(true);
    setPreviewLocale(locale);
    setPreviewLoading(true);
    try {
      const res = await api<{ subject: string; html: string }>(
        `/api/admin/templates/${selected.key}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            locale,
            subjectZh: form.subjectZh,
            subjectEn: form.subjectEn,
            bodyZh: form.bodyZh,
            bodyEn: form.bodyEn,
          }),
        },
      );
      setPreview(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "预览失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  /** Insert a `{{variable}}` chip at the caret of the last focused field. */
  function insertVariable(name: string) {
    const field = lastFocused.current;
    const el = fieldRefs.current[field];
    const token = `{{${name}}}`;
    let at: number | null = null;
    let end: number | null = null;
    if (el && document.activeElement === el && el.selectionStart !== null && el.selectionEnd !== null) {
      at = el.selectionStart;
      end = el.selectionEnd;
    }
    setForm((f) => {
      const cur = f[field];
      if (at === null || end === null) return { ...f, [field]: cur + token };
      return { ...f, [field]: cur.slice(0, at) + token + cur.slice(end) };
    });
    if (el && at !== null) {
      const pos = at + token.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    }
  }

  /* ------------------------------ render ------------------------------ */

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="通知模板" description="邮件模板定制、启用与预览；站内通知由发送处直接生成" />
        <div className="h-9 border-b border-border" />
        <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="通知模板"
        description="邮件模板定制、启用与预览；站内通知由发送处直接生成"
      />

      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as AdminTab)}
        tabs={[
          { id: "mail", label: "邮件模板" },
          { id: "insite", label: "站内通知" },
        ]}
      />

      {tab === "mail" && (
        <div className="grid items-start gap-6 pt-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* ------------------------ template list ------------------------ */}
          <div className="lg:sticky lg:top-20">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              模板列表 · 共 {rows.length} 个
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              {rows.map((row, i) => {
                const active = row.key === selectedKey;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => selectRow(row)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors",
                      i > 0 && "border-t border-border",
                      active ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.name.zh}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {row.key}
                      </span>
                    </span>
                    <TemplateStatusBadge row={row} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* --------------------------- editor --------------------------- */}
          {selected ? (
            <SettingsSection className="min-w-0">
              <SettingsSectionHeader
                title={
                  <>
                    {selected.name.zh}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {selected.key}
                    </span>
                    <TemplateStatusBadge row={selected} />
                  </>
                }
                description={selected.description.zh}
                action={
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => renderPreview(previewLocale)}
                      disabled={previewLoading}
                    >
                      <Eye className="size-4" />
                      预览
                    </Button>
                    <Button variant="outline" size="sm" onClick={reset} disabled={resetting}>
                      <RotateCcw className="size-4" />
                      重置为默认
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      <Save className="size-4" />
                      {saving ? "保存中…" : "保存"}
                    </Button>
                  </div>
                }
              />

              <div>
                <SettingRow
                  label="启用模板"
                  description="关闭后该模板的邮件将不再发送（渲染为空，邮件频道跳过投递）"
                  control={
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                    />
                  }
                />
              </div>

              <div className="grid gap-4">
                {SUBJECT_FIELDS.map((f) => (
                  <SettingField key={f.name} label={f.label}>
                    <Input
                      ref={(el) => {
                        fieldRefs.current[f.name] = el;
                      }}
                      value={form[f.name]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.name]: e.target.value }))}
                      onFocus={() => (lastFocused.current = f.name)}
                      placeholder={f.placeholder}
                    />
                  </SettingField>
                ))}

                {BODY_FIELDS.map((f) => (
                  <SettingField key={f.name} label={f.label} hint="正文使用 {{变量}} 占位；留空字段回落到内置文案">
                    <Textarea
                      ref={(el) => {
                        fieldRefs.current[f.name] = el;
                      }}
                      rows={8}
                      spellCheck={false}
                      className="font-mono text-xs"
                      value={form[f.name]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.name]: e.target.value }))}
                      onFocus={() => (lastFocused.current = f.name)}
                      placeholder={
                        "留空使用内置正文；例如：\n<p>你好 {{actor}}，请点击 <a href=\"{{url}}\">这里</a> 查看。</p>"
                      }
                    />
                  </SettingField>
                ))}
              </div>

              {/* variable chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">可用变量（点击插入到最近聚焦的输入框）：</span>
                {selected.variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="rounded-md bg-[var(--muted)] px-2 py-1 font-mono text-xs text-[color:var(--text-body)] transition-colors hover:bg-[var(--hover)]"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>

              {dirty ? (
                <p className="text-xs text-[var(--warning)]">
                  有未保存的修改；预览已包含当前编辑内容，保存后才会实际生效。
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">没有未保存的更改。</p>
              )}
            </SettingsSection>
          ) : (
            <EmptyState title="请选择左侧模板" hint="从左侧列表选择一个邮件模板进行定制" />
          )}
        </div>
      )}

      {tab === "insite" && (
        <SettingsSection className="pt-5">
          <SettingsSectionHeader description="站内通知的标题与正文由发送处直接生成，不经过邮件模板；此处管理的是邮件模板。完整说明见 docs/notifications.md。" />
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>通知 key</th>
                  <th>触发点</th>
                </tr>
              </thead>
              <tbody>
                {IN_SITE_KEYS.map((r) => (
                  <tr key={r.key}>
                    <td className="font-mono text-xs">{r.key}</td>
                    <td>{r.trigger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </SettingsSection>
      )}

      {/* --------------------------- preview --------------------------- */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>邮件预览{selected ? ` · ${selected.name.zh}` : ""}</DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">
              {preview?.subject ?? "渲染中…"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <FilterChips
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
              value={previewLocale}
              onChange={(v) => renderPreview(v as "zh" | "en")}
            />
            <div className="flex items-center gap-1">
              <Button
                variant={previewNarrow ? "outline" : "secondary"}
                size="icon-sm"
                onClick={() => setPreviewNarrow(false)}
                aria-label="桌面宽度"
              >
                <Monitor className="size-4" />
              </Button>
              <Button
                variant={previewNarrow ? "secondary" : "outline"}
                size="icon-sm"
                onClick={() => setPreviewNarrow(true)}
                aria-label="手机宽度"
              >
                <Smartphone className="size-4" />
              </Button>
            </div>
          </div>
          <div
            className={cn(
              "mx-auto w-full rounded-lg bg-[var(--muted)] p-3 transition-all",
              previewNarrow && "max-w-[375px]",
            )}
          >
            {previewLoading && !preview ? (
              <Skeleton className="h-[60vh] w-full rounded-lg" />
            ) : (
              <iframe
                title="邮件预览"
                sandbox=""
                srcDoc={preview?.html ?? ""}
                className="h-[60vh] w-full rounded-md border border-border bg-card"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
