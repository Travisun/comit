"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe, Loader2, Lock, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { routes } from "@/core/routes";
import { cn } from "@/lib/utils";
import {
  CONTENT_LABELS,
  getLabelDef,
  isHttpUrl,
  type ContentLabelId,
} from "@/lib/content-labels";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import { MarkdownEditor } from "./markdown-editor";
import { ImageUploader } from "./image-uploader";
import { TopicInput } from "./topic-input";
import { CollectionSelect } from "./collection-select";
import { BlockedDialog } from "./blocked-dialog";

/**
 * Full article editor: title + markdown editor on the left, publish-settings
 * panel (featured image / collection / topics / visibility / content label /
 * summary / slug) as a sticky card on desktop and a bottom-sheet dialog on
 * mobile. ⌘S saves the draft; 发布 runs action:'submit' (keyword gate → review).
 */

export interface EditorPost {
  id: string;
  title: string | null;
  content: string;
  summary: string;
  slug: string | null;
  status: "draft" | "pending_review" | "published" | "rejected";
  visibility: "public" | "followers";
  collectionId: string | null;
  coverPath: string | null;
  topicNames: string[];
  rejectReason?: string | null;
  /** content annotation (raw db value; unknown ids fall back to original) */
  label?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
}

interface SettingsState {
  coverPath: string | null;
  collectionId: string | null;
  topicNames: string[];
  visibility: "public" | "followers";
  summary: string;
  slug: string;
  label: ContentLabelId;
  sourceUrl: string;
  sourceName: string;
}

type SaveAction = "draft" | "submit" | "update";

export function ArticleEditor({ initial }: { initial?: EditorPost | null }) {
  const { t } = useI18n();
  const router = useRouter();

  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [settings, setSettings] = useState<SettingsState>({
    coverPath: initial?.coverPath ?? null,
    collectionId: initial?.collectionId ?? null,
    topicNames: initial?.topicNames ?? [],
    visibility: initial?.visibility ?? "public",
    summary: initial?.summary ?? "",
    slug: initial?.slug ?? "",
    label: getLabelDef(initial?.label).id,
    sourceUrl: initial?.sourceUrl ?? "",
    sourceName: initial?.sourceName ?? "",
  });
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [saving, setSaving] = useState<SaveAction | null>(null);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const patch = (p: Partial<SettingsState>) => setSettings((s) => ({ ...s, ...p }));

  const save = async (action: SaveAction) => {
    if (!title.trim()) {
      toast.error("请输入标题 / Title required");
      return;
    }
    if (!content.trim()) {
      toast.error("正文不能为空 / Content required");
      return;
    }
    if (settings.label === "repost" && !isHttpUrl(settings.sourceUrl)) {
      toast.error("转载内容需填写原文地址（http(s)://…） / Reposts require a valid source URL");
      return;
    }
    setSaving(action);
    try {
      const repost =
        settings.label === "repost" && isHttpUrl(settings.sourceUrl.trim())
          ? {
              sourceUrl: settings.sourceUrl.trim(),
              ...(settings.sourceName.trim()
                ? { sourceName: settings.sourceName.trim() }
                : {}),
            }
          : {};
      const payload = {
        type: "article" as const,
        title: title.trim(),
        content,
        summary: settings.summary.trim() ? settings.summary.trim() : null,
        visibility: settings.visibility,
        collectionId: settings.collectionId,
        coverPath: settings.coverPath,
        topicNames: settings.topicNames,
        label: settings.label,
        ...repost,
        ...(settings.slug.trim() ? { slug: settings.slug.trim() } : {}),
        ...(action === "update" ? {} : { action }),
      };
      const res = id
        ? await fetch(`/api/posts/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = (await res.json()) as {
        id?: string;
        slug?: string | null;
        status?: EditorPost["status"];
        error?: string;
        blocked?: string[];
      };

      if (res.status === 422 && Array.isArray(data.blocked)) {
        setBlocked(data.blocked);
        return;
      }
      if (!res.ok || !data.id) {
        toast.error(data.error ?? t("common.error"));
        return;
      }

      setId(data.id);
      if (data.slug) patch({ slug: data.slug });
      if (data.status) setStatus(data.status);

      if (action === "draft") {
        toast.success(t("editor.saved"));
        if (!id) router.replace(routes.editorEdit(data.id));
        return;
      }
      if (action === "update") {
        toast.success(t("editor.saved"));
        return;
      }
      // submit → published directly (reviewMode=off) or queued for review
      toast.success(data.status === "published" ? t("editor.publish") : t("post.pendingReview"));
      router.push(routes.home);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(null);
    }
  };

  const saveDraftRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveDraftRef.current = () => void save(status === "published" ? "update" : "draft");
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDraftRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fields = <SettingsFields settings={settings} patch={patch} disabled={saving !== null} />;
  const isPublished = status === "published";
  const primaryLabel = isPublished ? t("common.save") : t("editor.publish");
  const primaryAction: SaveAction = isPublished ? "update" : "submit";

  const buttons = (onAfter?: () => void) => (
    <div className="flex gap-2">
      {!isPublished && (
        <Button
          variant="secondary"
          className="flex-1"
          disabled={saving !== null}
          onClick={() => {
            void save("draft");
            onAfter?.();
          }}
        >
          {saving === "draft" ? <Loader2 className="animate-spin" /> : null}
          {t("editor.saveDraft")}
        </Button>
      )}
      <Button
        className="flex-1"
        disabled={saving !== null}
        onClick={() => {
          void save(primaryAction);
          if (primaryAction === "submit") onAfter?.();
        }}
      >
        {saving === primaryAction ? <Loader2 className="animate-spin" /> : null}
        {primaryLabel}
      </Button>
    </div>
  );

  return (
    /* Focus layout: middle column fills all remaining height/width, publish
       settings docked hard-right as a full-height rail with its own scroll.
       Height subtracts the console top bar (h-14) rendered by the shell. */
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:h-[calc(100dvh-3.5rem)] lg:min-h-0 lg:flex-row lg:overflow-hidden">
      {/* middle — editor column */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-20 pt-4 md:px-6 lg:overflow-hidden lg:pb-0 lg:pt-5">
        {status === "rejected" && initial?.rejectReason && (
          <div className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {t("post.rejected")}：{initial.rejectReason}
          </div>
        )}
        {(status === "pending_review" || isPublished) && (
          <div className="shrink-0">
            <Badge variant={isPublished ? "success" : "warning"}>
              {isPublished ? t("editor.publish") : t("post.pendingReview")}
            </Badge>
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("editor.titlePlaceholder")}
          maxLength={200}
          className="w-full shrink-0 bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />
        <MarkdownEditor
          value={content}
          onChange={setContent}
          onSave={() => saveDraftRef.current()}
          placeholder={t("editor.bodyPlaceholder")}
          className="min-h-[55vh] flex-1 lg:min-h-0"
        />
      </div>

      {/* right — docked publish rail, always flush right, own scroll */}
      <aside className="hidden w-[340px] shrink-0 flex-col gap-5 overflow-y-auto bg-[var(--muted)] px-5 py-5 lg:flex">
        <h2 className="text-sm font-semibold">{t("editor.settings")}</h2>
        {fields}
        <div className="mt-auto pt-2">{buttons()}</div>
      </aside>

      {/* mobile: bottom bar + settings sheet */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 bg-white p-3 lg:hidden">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setSheetOpen(true)}
        >
          {t("editor.settings")}
        </Button>
        {buttons()}
      </div>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>{t("editor.settings")}</DialogTitle>
          {fields}
          {buttons(() => setSheetOpen(false))}
        </DialogContent>
      </Dialog>

      <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
    </div>
  );
}

/* --------------------------- publish settings ----------------------------- */

function SettingsFields({
  settings,
  patch,
  disabled,
}: {
  settings: SettingsState;
  patch: (p: Partial<SettingsState>) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.cover")}</Label>
        <ImageUploader
          kind="featured"
          value={settings.coverPath}
          onChange={(path) => patch({ coverPath: path })}
          hint={t("editor.coverHint")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.collection")}</Label>
        <CollectionSelect
          value={settings.collectionId}
          onChange={(cid) => patch({ collectionId: cid })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.topics")}</Label>
        <TopicInput
          value={settings.topicNames}
          onChange={(names) => patch({ topicNames: names })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.visibility")}</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["public", t("editor.visibilityPublic"), <GlobeIcon key="g" />],
              ["followers", t("editor.visibilityFollowers"), <LockIcon key="l" />],
            ] as const
          ).map(([val, label, icon]) => (
            <button
              key={val}
              type="button"
              disabled={disabled}
              onClick={() => patch({ visibility: val })}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                settings.visibility === val
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-[var(--muted)] hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      <ContentLabelPicker
        label={settings.label}
        sourceUrl={settings.sourceUrl}
        sourceName={settings.sourceName}
        disabled={disabled}
        onChange={(p) => patch(p)}
      />

      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.summary")}</Label>
        <Textarea
          rows={3}
          disabled={disabled}
          value={settings.summary}
          onChange={(e) => patch({ summary: e.target.value })}
          placeholder={t("editor.summaryPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("editor.slug")}</Label>
        <Input
          disabled={disabled}
          value={settings.slug}
          onChange={(e) => patch({ slug: e.target.value })}
          placeholder={t("editor.slug")}
        />
      </div>
    </div>
  );
}

function GlobeIcon() {
  return <Globe className="size-4" />;
}

function LockIcon() {
  return <Lock className="size-4" />;
}

/* --------------------------- content label picker ------------------------- */

/**
 * Douyin-style content annotation picker: one radio row per label with a
 * colored badge preview (hover for the explanation), the selected label's
 * description shown right below the list. `repost` expands required source
 * URL + optional source name inputs; AI labels show a disclosure reminder.
 */
function ContentLabelPicker({
  label,
  sourceUrl,
  sourceName,
  disabled,
  onChange,
}: {
  label: ContentLabelId;
  sourceUrl: string;
  sourceName: string;
  disabled: boolean;
  onChange: (p: Partial<SettingsState>) => void;
}) {
  const { locale } = useI18n();
  const def = getLabelDef(label);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{locale === "zh" ? "内容标注" : "Content label"}</Label>
      <div role="radiogroup" aria-label={locale === "zh" ? "内容标注" : "Content label"} className="flex flex-col gap-0.5">
        {CONTENT_LABELS.map((d) => {
          const checked = d.id === label;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange({ label: d.id })}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                checked ? "bg-[var(--selected,#eef4fb)]" : "hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-4 shrink-0 rounded-full border-2 transition-colors",
                  checked ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--background)]" : "border-input bg-card",
                )}
              />
              <AnnotationBadge label={d.id} size="sm" />
            </button>
          );
        })}
      </div>

      {/* selected label's explanation — updates immediately on change */}
      <p className="px-2 text-xs leading-relaxed text-muted-foreground">{def.desc[locale]}</p>

      {def.needsSource && (
        <div className="flex flex-col gap-2 rounded-lg bg-[var(--muted)] p-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              {locale === "zh" ? "原文地址（必填）" : "Source URL (required)"}
            </Label>
            <Input
              disabled={disabled}
              type="url"
              inputMode="url"
              value={sourceUrl}
              onChange={(e) => onChange({ sourceUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              {locale === "zh" ? "来源名称（可选）" : "Source name (optional)"}
            </Label>
            <Input
              disabled={disabled}
              maxLength={200}
              value={sourceName}
              onChange={(e) => onChange({ sourceName: e.target.value })}
              placeholder={locale === "zh" ? "如：某技术社区" : "e.g. A tech community"}
            />
          </div>
        </div>
      )}

      {(label === "ai_assisted" || label === "ai_generated") && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--muted)] p-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {locale === "zh"
            ? "感谢你主动标注 AI 内容——平台鼓励如实披露创作方式；未如实标注可能影响内容在社区的推荐与信任。"
            : "Thanks for disclosing AI involvement — honest labeling keeps the community trusted; undisclosed AI content may lose reach and trust."}
        </p>
      )}
    </div>
  );
}
