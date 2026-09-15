"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Globe, Loader2, Lock, Info, Send } from "lucide-react";
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
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { VditorEditor } from "./vditor-editor";
import { ImageUploader } from "./image-uploader";
import { TopicInput } from "./topic-input";
import { CollectionSelect } from "./collection-select";
import { BlockedDialog } from "./blocked-dialog";
import { ARTICLE_DRAFT_KEY, postJsonSafe, putJsonSafe } from "@/lib/client/api";

/**
 * Full-page article editor:
 *   ┌ top strip (back · status · slug ┆ 保存草稿 / 发布) ┐
 *   ┌ centered writing column: title + live-render markdown ┐
 * Publish settings (cover / topics / visibility / label / summary / slug)
 * open in a dialog only when 发布 is clicked. ⌘S saves the draft; 发布 runs
 * action:'submit' (keyword gate → review).
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
  label: ContentLabelId;
  sourceUrl: string;
  sourceName: string;
}

type SaveAction = "draft" | "submit" | "update";

export function ArticleEditor({ initial }: { initial?: EditorPost | null }) {
  const { t, locale } = useI18n();
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
    label: getLabelDef(initial?.label).id,
    sourceUrl: initial?.sourceUrl ?? "",
    sourceName: initial?.sourceName ?? "",
  });
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [saving, setSaving] = useState<SaveAction | null>(null);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const patch = (p: Partial<SettingsState>) => setSettings((s) => ({ ...s, ...p }));

  // create mode: pick up a manuscript started in the composer drawer (it
  // autosaves to the shared local draft) once, after hydration
  const handoffDone = useRef(false);
  useEffect(() => {
    if (initial || handoffDone.current) return;
    handoffDone.current = true;
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(ARTICLE_DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw) as {
          title?: string;
          article?: string;
          topics?: string[];
          collectionId?: string | null;
          label?: string;
          sourceUrl?: string;
          sourceName?: string;
          visibility?: string;
        };
        if (d.title) setTitle(d.title);
        if (d.article) setContent(d.article);
        const p: Partial<SettingsState> = {};
        if (Array.isArray(d.topics) && d.topics.length) p.topicNames = d.topics;
        if (d.collectionId) p.collectionId = d.collectionId;
        if (d.label) p.label = getLabelDef(d.label).id;
        if (d.sourceUrl) p.sourceUrl = d.sourceUrl;
        if (d.sourceName) p.sourceName = d.sourceName;
        if (d.visibility === "followers") p.visibility = "followers";
        if (Object.keys(p).length) patch(p);
        localStorage.removeItem(ARTICLE_DRAFT_KEY);
        if (d.title || d.article) {
          toast.message(locale === "zh" ? "已带入手稿草稿" : "Carried over your draft");
        }
      } catch {
        // corrupted draft — start clean
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // local autosave (create mode only) — protects against tab closes before
  // the first ⌘S; cleared once the post persists server-side
  useEffect(() => {
    if (initial) return;
    const timer = window.setTimeout(() => {
      try {
        if (title.trim() || content.trim()) {
          localStorage.setItem(
            ARTICLE_DRAFT_KEY,
            JSON.stringify({
              title,
              article: content,
              topics: settings.topicNames,
              collectionId: settings.collectionId,
              label: settings.label,
              sourceUrl: settings.sourceUrl,
              sourceName: settings.sourceName,
              visibility: settings.visibility,
            }),
          );
        }
      } catch {
        // private mode / quota — best-effort
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, content, settings, initial]);

  const validate = (): boolean => {
    if (!content.trim()) {
      toast.error("正文不能为空 / Content required");
      return false;
    }
    if (settings.label === "repost" && !isHttpUrl(settings.sourceUrl)) {
      toast.error("转载内容需填写原文地址（http(s)://…） / Reposts require a valid source URL");
      return false;
    }
    return true;
  };

  const save = async (action: SaveAction) => {
    if (!validate()) return;
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
        ...(action === "update" ? {} : { action }),
      };
      type SaveResponse = {
        id?: string;
        slug?: string | null;
        status?: EditorPost["status"];
      };
      const r = id
        ? await putJsonSafe<SaveResponse>(`/api/posts/${id}`, payload)
        : await postJsonSafe<SaveResponse>("/api/posts", payload);

      if (!r.ok) {
        if (r.status === 422 && Array.isArray(r.blocked)) {
          setBlocked(r.blocked);
          return;
        }
        toast.error(r.error ?? t("common.error"));
        return;
      }
      const data = r.data;
      if (!data.id) {
        toast.error(t("common.error"));
        return;
      }

      setId(data.id);
      if (data.status) setStatus(data.status);
      // persisted server-side — the local handoff/autosave copy is no longer needed
      try {
        localStorage.removeItem(ARTICLE_DRAFT_KEY);
      } catch {
        // ignore
      }

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
      setPublishOpen(false);
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

  const isPublished = status === "published";
  const slugPath = (initial?.slug || id) && status !== "draft" ? `/post/${initial?.slug ?? id}` : null;

  /** 发布 click → open the settings dialog (validated already) */
  function requestPublish() {
    if (!content.trim()) {
      validate();
      return;
    }
    setPublishOpen(true);
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] overflow-hidden md:h-dvh md:pb-0">
      {/* right-hand column: top strip + fullscreen editor */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label={locale === "zh" ? "返回" : "Back"}
              title={locale === "zh" ? "返回首页" : "Back to home"}
              onClick={() => router.push(routes.home)}
              className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
            {status !== "draft" && (
              <Badge variant={isPublished ? "success" : "warning"}>
                {isPublished ? t("editor.publish") : t("post.pendingReview")}
              </Badge>
            )}
            {status === "rejected" && initial?.rejectReason && (
              <span className="truncate text-xs text-destructive">
                {t("post.rejected")}：{initial.rejectReason}
              </span>
            )}
            {slugPath && (
              <Link
                href={slugPath}
                target="_blank"
                className="hidden font-mono text-xs text-muted-foreground hover:text-foreground lg:inline"
              >
                {slugPath}
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isPublished && (
              <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => void save("draft")}>
                {saving === "draft" ? <Loader2 className="animate-spin" /> : null}
                {t("editor.saveDraft")}
              </Button>
            )}
            {isPublished ? (
              <Button size="sm" disabled={saving !== null} onClick={() => void save("update")}>
                {saving === "update" ? <Loader2 className="animate-spin" /> : null}
                {t("common.save")}
              </Button>
            ) : (
              <Button size="sm" disabled={saving !== null} onClick={requestPublish}>
                <Send className="size-3.5" />
                {t("editor.publish")}
              </Button>
            )}
          </div>
        </div>

        {/* fullscreen editor surface: centered writing column */}
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 pt-6 md:px-10">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("editor.titlePlaceholder")}
              maxLength={200}
              className="reading-serif w-full bg-transparent text-3xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="mx-auto w-full max-w-4xl md:px-4">
            <VditorEditor
              value={content}
              onChange={setContent}
              onSave={() => saveDraftRef.current()}
              placeholder={t("editor.bodyPlaceholder")}
              className="min-h-[calc(100dvh-12rem)]"
            />
          </div>
        </div>
      </div>

      {/* publish dialog — settings only appear here, on demand */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{t("editor.settings")}</DialogTitle>
          <SettingsFields settings={settings} patch={patch} disabled={saving !== null} />
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button disabled={saving !== null} onClick={() => void save("submit")}>
              {saving === "submit" ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
              {t("editor.publish")}
            </Button>
          </DialogFooter>
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
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
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
                  : "border-border bg-[var(--muted)] hover:bg-[var(--hover)]",
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

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("editor.summary")}</Label>
        <Textarea
          rows={2}
          disabled={disabled}
          value={settings.summary}
          onChange={(e) => patch({ summary: e.target.value })}
          placeholder={t("editor.summaryPlaceholder")}
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
      <div className="relative">
        <select
          value={label}
          disabled={disabled}
          onChange={(e) => onChange({ label: e.target.value as ContentLabelId })}
          aria-label={locale === "zh" ? "内容标注" : "Content label"}
          className="h-[30px] w-full appearance-none rounded-md border-0 bg-card pl-2 pr-8 text-sm text-[color:var(--text-body)] shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)] outline-none focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)] disabled:opacity-50"
        >
          {CONTENT_LABELS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name[locale]}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{def.desc[locale]}</p>

      {def.needsSource && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
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
        <p className="flex items-start gap-1.5 rounded-md bg-[var(--muted)] p-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {locale === "zh"
            ? "感谢你主动标注 AI 内容——平台鼓励如实披露创作方式；未如实标注可能影响内容在社区的推荐与信任。"
            : "Thanks for disclosing AI involvement — honest labeling keeps the community trusted; undisclosed AI content may lose reach and trust."}
        </p>
      )}
    </div>
  );
}
