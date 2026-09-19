"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
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
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

const overrideStateSchema = z.object({
  subjectZh: z.string().optional(),
  subjectEn: z.string().optional(),
  bodyZh: z.string().optional(),
  bodyEn: z.string().optional(),
  enabled: z.boolean(),
});

const templateRowSchema = z.object({
  key: z.string(),
  name: z.object({ zh: z.string(), en: z.string() }),
  description: z.object({ zh: z.string(), en: z.string() }),
  variables: z.array(z.string()),
  locale: z.literal("both"),
  override: overrideStateSchema.nullable(),
  customized: z.boolean(),
  enabled: z.boolean(),
});

const templatesResponseSchema = z.object({
  templates: z.array(templateRowSchema),
});

type TemplateRow = z.infer<typeof templateRowSchema>;

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tab, setTab] = useState<AdminTab>("mail");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<"zh" | "en">("zh");
  const [previewNarrow, setPreviewNarrow] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);

  const selectedKeyRef = useRef<string | null>(null);
  const lastFocused = useRef<TextField>("bodyZh");
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  // 模板注册表查询 — 保存/重置后 invalidate 重取，等价原 load()
  const templatesQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminTemplates(),
      url: "/api/admin/templates",
      schema: templatesResponseSchema,
    }),
  );
  const templates = templatesQ.data?.templates;
  // rows 用 useMemo 稳定标识：避免派生数组每渲染新建导致播种 effect 反复触发
  const rows = useMemo(() => templates ?? [], [templates]);
  const loading = templatesQ.isLoading;

  const selected = rows.find((r) => r.key === selectedKey);
  const dirty = isDirty(form, selected);

  // 选中行播种：数据到达/重取后按 ref 里的选中键恢复选中与表单（等价原 applyRows）
  useEffect(() => {
    if (rows.length === 0) return;
    const row = rows.find((r) => r.key === selectedKeyRef.current) ?? rows[0];
    selectedKeyRef.current = row.key;
    setSelectedKey(row.key);
    setForm(formFromRow(row));
  }, [rows]);

  const confirm = useConfirmDialog();

  async function selectRow(row: TemplateRow) {
    if (row.key === selectedKeyRef.current) return;
    if (dirty && !(await confirm({ title: "当前模板有未保存的修改，确定切换吗？", confirmLabel: "切换" }))) return;
    selectedKeyRef.current = row.key;
    setSelectedKey(row.key);
    setForm(formFromRow(row));
    setPreview(null);
  }

  // 保存覆盖 — 成功失效模板键（重取 + 表单重播种）
  const saveMutation = useApiMutation(
    (input: { key: string; form: FormState }) => postJson(`/api/admin/templates/${input.key}`, input.form),
    {
      refresh: false,
      invalidate: [queryKeys.adminTemplates()],
      onSuccess: () => toast.success(selected ? `模板「${selected.name.zh}」已保存` : "模板已保存"),
    },
  );

  // 重置为内置 — 同样失效重取
  const resetMutation = useApiMutation(
    (key: string) => postJson(`/api/admin/templates/${key}/reset`, {}),
    {
      refresh: false,
      invalidate: [queryKeys.adminTemplates()],
      successToast: "已重置为默认模板",
    },
  );

  // 预览渲染 — POST 但属临时产物（不上缓存），结果进本地 state
  const previewMutation = useApiMutation(
    (input: { key: string; locale: "zh" | "en"; form: FormState }) =>
      postJson<{ subject: string; text: string }>(`/api/admin/templates/${input.key}/preview`, {
        locale: input.locale,
        subjectZh: input.form.subjectZh,
        subjectEn: input.form.subjectEn,
        bodyZh: input.form.bodyZh,
        bodyEn: input.form.bodyEn,
      }),
    {
      refresh: false,
      onSuccess: (data) => setPreview(data),
    },
  );

  async function reset() {
    if (!selected) return;
    if (!(await confirm({ title: `确定将「${selected.name.zh}」重置为内置模板吗？`, confirmLabel: "重置", danger: true }))) return;
    void resetMutation.mutate(selected.key);
  }

  function renderPreview(locale: "zh" | "en") {
    if (!selected) return;
    setPreviewOpen(true);
    setPreviewLocale(locale);
    void previewMutation.mutate({ key: selected.key, locale, form });
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
                      disabled={previewMutation.pending}
                    >
                      <Eye className="size-4" />
                      预览
                    </Button>
                    <Button variant="outline" size="sm" onClick={reset} disabled={resetMutation.pending}>
                      <RotateCcw className="size-4" />
                      重置为默认
                    </Button>
                    <Button
                      size="sm"
                      disabled={saveMutation.pending}
                      onClick={() => {
                        if (selected) void saveMutation.mutate({ key: selected.key, form });
                      }}
                    >
                      <Save className="size-4" />
                      {saveMutation.pending ? "保存中…" : "保存"}
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
            {previewMutation.pending && !preview ? (
              <Skeleton className="h-[60vh] w-full rounded-lg" />
            ) : (
              // 邮件已全量纯文本化：预览即最终文本形态（等宽滚动区）
              <pre className="h-[60vh] w-full overflow-auto rounded-md border border-border bg-card p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {preview?.text ?? ""}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
