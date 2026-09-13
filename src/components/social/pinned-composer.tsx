"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ImagePlus,
  Loader2,
  PenLine,
  RotateCcw,
  Send,
  Smile,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  ARTICLE_DRAFT_KEY,
  SHORT_DRAFT_KEY,
  isAuthError,
  mediaUrl,
  postJsonSafe,
  requestJson,
} from "./api";
import { BlockedDialog } from "../editor/blocked-dialog";
import { EmojiPopover, insertAtCursor } from "./composer-panels";
import { PinnedBar } from "./pinned-bar";

/** mirrors SHORT_CONTENT_MAX on the server */
const SHORT_MAX = 5000;
/** mirrors mediaPaths max on the server */
const MAX_IMAGES = 9;
/** counter turns warning this many chars before the limit */
const WARN_AT = 4800;

type ImgStatus = "uploading" | "done" | "error";

interface ImgItem {
  key: string;
  status: ImgStatus;
  url?: string;
  /** kept in memory so a failed tile can retry */
  file?: File;
}

interface ShortDraft {
  content: string;
  images: { url: string }[];
}

function readShortDraft(): ShortDraft | null {
  try {
    const raw = localStorage.getItem(SHORT_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as ShortDraft;
    if (d.content || (d.images?.length ?? 0) > 0) return d;
  } catch {
    // corrupted draft — start clean
  }
  return null;
}

/**
 * The home composer, pinned to the bottom of the panel at all times
 * (drawer retired). Clicking it expands the bar in place into the full
 * short-post form: markdown textarea, paste/drag image upload, emoji panel.
 * Content labels (原创/转载…) are intentionally absent here — they belong to
 * the long-form editor's publish settings.
 *
 * Keyboard: Enter sends · Ctrl/⌘+Enter and Shift+Enter insert a newline
 * (IME-composition safe). Drafts autosave to localStorage, so collapsing or
 * navigating away never destroys work. "文章" hands the manuscript to the
 * full-page /write editor.
 */
export function PinnedComposer({
  user,
  initialExpanded = false,
}: {
  user: { displayName: string; username: string; avatarPath: string | null };
  initialExpanded?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const zh = locale === "zh";

  const [initialDraft] = useState(readShortDraft);
  const [expanded, setExpanded] = useState(initialExpanded || initialDraft !== null);

  const [content, setContent] = useState(initialDraft?.content ?? "");
  const [images, setImages] = useState<ImgItem[]>(() =>
    (initialDraft?.images ?? [])
      .filter((i) => i?.url)
      .map((i) => ({ key: `restored-${i.url}`, status: "done", url: i.url })),
  );

  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draftSaved, setDraftSaved] = useState<Date | null>(null);
  const loadedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // deep link (?compose=1) or restored draft → the composer starts expanded
  // and the caret goes straight into the textarea. The textarea lives inside
  // PinnedBar's portal, so retry until it mounts.
  const focusCaret = useCallback(() => {
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = taRef.current;
      if (el) {
        el.focus();
        return;
      }
      if (++tries < 30) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!initialExpanded) return;
    focusCaret();
  }, [initialExpanded, focusCaret]);

  // 创作 triggers on the home page ping the composer through this event
  useEffect(() => {
    const onFocus = () => {
      setExpanded(true);
      focusCaret();
    };
    window.addEventListener("composer:focus", onFocus);
    return () => window.removeEventListener("composer:focus", onFocus);
  }, [focusCaret]);

  /* --------------------------- draft autosave ---------------------------- */

  useEffect(() => {
    if (initialDraft) {
      toast.message(zh ? "已恢复上次未发布的草稿" : "Restored your unpublished draft");
    }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast once on mount
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const doneImages = images
          .filter((i) => i.status === "done" && i.url)
          .map((i) => ({ url: i.url! }));
        if (content.trim() || doneImages.length > 0) {
          localStorage.setItem(
            SHORT_DRAFT_KEY,
            JSON.stringify({ content, images: doneImages } satisfies ShortDraft),
          );
        } else {
          localStorage.removeItem(SHORT_DRAFT_KEY);
        }
        setDraftSaved(new Date());
      } catch {
        // private mode / quota — autosave is best-effort
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [content, images]);

  /* --------------------------- expand / collapse ------------------------- */

  const hasContent = content.trim().length > 0 || images.some((i) => i.status === "done");

  function expand() {
    setExpanded(true);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function collapse() {
    setExpanded(false);
  }

  // click outside collapses an empty composer; with content it stays (drafts
  // keep working, the form is never lost to a stray click)
  useEffect(() => {
    if (!expanded || hasContent) return;
    const onDocDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) collapse();
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [expanded, hasContent]);

  // auto-grow the textarea, capping at ~35dvh
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
  }, [content, expanded]);

  /* ------------------------------- uploads ------------------------------- */

  const uploadOne = useCallback(
    async (item: ImgItem) => {
      if (!item.file) return;
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("kind", "inline");
      try {
        const r = await requestJson<{ url: string }>("/api/media/upload", {
          method: "POST",
          body: fd,
        });
        setImages((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, status: "done", url: r.url } : i)),
        );
      } catch (err) {
        if (isAuthError(err)) {
          toast.error(err instanceof Error ? err.message : t("common.error"));
          router.push("/auth/login");
        } else {
          toast.error(t("editor.uploadFail"));
        }
        setImages((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, status: "error" } : i)),
        );
      }
    },
    [router, t],
  );

  const uploadFiles = useCallback(
    (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (files.length > 0 && imgs.length === 0) {
        toast.error(zh ? "仅支持图片文件" : "Only image files are supported");
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        toast.error(zh ? `最多 ${MAX_IMAGES} 张图片` : `Up to ${MAX_IMAGES} images`);
        return;
      }
      if (imgs.length > room) {
        toast.error(
          zh
            ? `最多 ${MAX_IMAGES} 张图片，已保留前 ${room} 张`
            : `Limited to ${MAX_IMAGES} images — kept the first ${room}`,
        );
      }
      const batch: ImgItem[] = imgs.slice(0, room).map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "uploading",
        file: f,
      }));
      setImages((prev) => [...prev, ...batch]);
      for (const item of batch) void uploadOne(item);
    },
    [images.length, uploadOne, zh],
  );

  const retryImage = useCallback(
    (item: ImgItem) => {
      setImages((prev) =>
        prev.map((i) => (i.key === item.key ? { ...i, status: "uploading" } : i)),
      );
      void uploadOne(item);
    },
    [uploadOne],
  );

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) uploadFiles(files);
  }

  /* ------------------------------ publishing ----------------------------- */

  async function publish() {
    if (busy || uploadingCount > 0) return;
    const text = content.trim();
    const done = images.filter((i) => i.status === "done" && i.url);
    if (!text && done.length === 0) return;
    setBusy(true);
    try {
      const full =
        done.length > 0
          ? `${text}${text ? "\n\n" : ""}${done.map((i) => `![](${i.url})`).join("\n\n")}`
          : text;
      const r = await postJsonSafe("/api/posts", {
        type: "short",
        content: full,
        action: "submit",
      });
      if (!r.ok) {
        if (r.blocked?.length) {
          setBlocked(r.blocked);
          return;
        }
        toast.error(r.error ?? t("common.error"));
        if (r.status === 401 || r.status === 403) router.push("/auth/login");
        return;
      }
      setContent("");
      setImages([]);
      try {
        localStorage.removeItem(SHORT_DRAFT_KEY);
      } catch {
        // ignore
      }
      setDraftSaved(null);
      toast.success(t("feed.publish"));
      collapse();
      router.refresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  /** hand the typed text to the full-page article editor (/write) */
  function openArticleEditor() {
    const text = content.trim();
    try {
      if (text) {
        localStorage.setItem(
          ARTICLE_DRAFT_KEY,
          JSON.stringify({
            title: "",
            article: text,
            topics: [],
            collectionId: null,
            sourceUrl: "",
            sourceName: "",
          }),
        );
        localStorage.removeItem(SHORT_DRAFT_KEY);
      }
    } catch {
      // ignore — navigation still works, just without the handoff
    }
    router.push("/write");
  }

  function pickEmoji(emoji: string) {
    insertAtCursor(taRef.current, emoji, content, setContent);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (!hasContent) collapse();
      return;
    }
    if (e.key !== "Enter") return;
    if (e.shiftKey) return; // newline
    if (e.nativeEvent.isComposing) return; // IME composition — never send
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/⌘+Enter → explicit newline
      insertAtCursor(taRef.current, "\n", content, setContent);
      return;
    }
    void publish();
  }

  /* ------------------------------- render -------------------------------- */

  const uploadingCount = images.filter((i) => i.status === "uploading").length;
  const canPublish =
    (content.trim().length > 0 || images.some((i) => i.status === "done")) &&
    uploadingCount === 0;

  return (
    <PinnedBar>
      <div
        ref={cardRef}
        className={cn(
          "relative rounded-2xl border bg-card/95 shadow-[0_4px_16px_rgba(42,47,69,0.12)] backdrop-blur transition-colors",
          dragOver && "border-primary/50",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl bg-card/90">
            <span className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary">
              {zh ? "松开以添加图片" : "Drop images to attach"}
            </span>
          </div>
        )}

        {expanded ? (
          <div className="px-2 pt-2">
            <Textarea
              ref={taRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              placeholder={t("feed.composePlaceholder")}
              maxLength={SHORT_MAX}
              className="min-h-16 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-[15px] shadow-none focus-visible:shadow-none"
            />
            {images.length > 0 && (
              <div
                className={cn(
                  "mt-1 grid gap-1.5 px-1 pb-1",
                  images.length === 1 && "max-w-xs grid-cols-1",
                  images.length === 2 && "max-w-md grid-cols-2",
                  images.length >= 3 && "max-w-md grid-cols-3",
                )}
              >
                {images.map((item) => (
                  <ImageTile
                    key={item.key}
                    item={item}
                    large={images.length === 1}
                    removeLabel={t("common.delete")}
                    retryLabel={zh ? "重新上传" : "Retry upload"}
                    onRemove={() => setImages((prev) => prev.filter((i) => i.key !== item.key))}
                    onRetry={() => retryImage(item)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2">
            <Avatar className="mx-1 size-8 shrink-0">
              {user.avatarPath && <AvatarImage src={mediaUrl(user.avatarPath)} alt={user.displayName} />}
              <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={expand}
              className="h-9 min-w-0 flex-1 rounded-full bg-[var(--muted)] px-4 text-left text-sm text-muted-foreground transition-colors hover:bg-[var(--hover)]"
            >
              <span className="block truncate">{t("feed.compose")}</span>
            </button>
          </div>
        )}

        {/* toolbar */}
        <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (!expanded) expand();
                uploadFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <ToolButton
              label={zh ? "图片" : "Image"}
              onClick={() => {
                if (!expanded) expand();
                requestAnimationFrame(() => fileRef.current?.click());
              }}
            >
              <ImagePlus className="size-[18px]" />
            </ToolButton>
            <EmojiPopover label={zh ? "表情" : "Emoji"} onPick={(emoji) => {
              if (!expanded) expand();
              pickEmoji(emoji);
            }}>
              <Smile className="size-[18px]" />
            </EmojiPopover>
            <ToolButton label={zh ? "转长文" : "To article"} onClick={openArticleEditor}>
              <PenLine className="size-[18px]" />
            </ToolButton>
            {uploadingCount > 0 && (
              <span aria-live="polite" className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {content.length > 0 && (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  content.length >= SHORT_MAX
                    ? "text-destructive"
                    : content.length >= WARN_AT
                      ? "text-[color:var(--warning)]"
                      : "text-muted-foreground",
                )}
              >
                {content.length} / {SHORT_MAX}
              </span>
            )}
            {hasContent && draftSaved && (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Check className="size-3" aria-hidden />
                {zh ? "已保存" : "Saved"}
              </span>
            )}
            <Button
              type="button"
              size="icon-sm"
              aria-label={t("feed.publish")}
              title={zh ? "Enter 发送 · Shift/Ctrl+Enter 换行" : "Enter to send · Shift/Ctrl+Enter for newline"}
              className="rounded-full"
              disabled={!canPublish || busy}
              onClick={() => void publish()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </Button>
          </div>
        </div>
      </div>

      <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
    </PinnedBar>
  );
}

/* ----------------------------- tool button -------------------------------- */

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ------------------------------- image tile ------------------------------- */

function ImageTile({
  item,
  large,
  removeLabel,
  retryLabel,
  onRemove,
  onRetry,
}: {
  item: { status: string; url?: string };
  large: boolean;
  removeLabel: string;
  retryLabel: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={cn("group/tile relative", large ? "aspect-[4/3]" : "aspect-square")}>
      {item.status === "done" && item.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(item.url)}
          alt=""
          className="size-full rounded-lg border border-border object-cover"
        />
      ) : item.status === "uploading" ? (
        <div
          aria-live="polite"
          className="grid size-full animate-pulse place-items-center rounded-lg border border-border bg-[var(--muted)] text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </div>
      ) : (
        <div className="grid size-full place-items-center rounded-lg border border-destructive/40 bg-destructive/5">
          <button
            type="button"
            aria-label={retryLabel}
            title={retryLabel}
            onClick={onRetry}
            className="grid size-7 place-items-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className={cn(
          "absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground/90 text-background shadow-sm",
          "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tile:opacity-100 max-md:opacity-100",
        )}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}
