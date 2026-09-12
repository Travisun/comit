"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { isAuthError, mediaUrl, postJson, requestJson } from "./api";

interface ViewerInfo {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
}

let cachedViewer: ViewerInfo | null | undefined;

/** Fetch the signed-in viewer once per session for the avatar chip. */
async function fetchViewer(): Promise<ViewerInfo | null> {
  if (cachedViewer !== undefined) return cachedViewer;
  try {
    const r = await requestJson<ViewerInfo | null>("/api/comments/viewer");
    cachedViewer = r;
    return r;
  } catch {
    cachedViewer = null;
    return null;
  }
}

export function Composer({ placeholder }: { placeholder?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchViewer().then((v) => {
      if (!cancelled) setViewer(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const uploadImages = useCallback(
    async (files: Iterable<File>) => {
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        setUploading((u) => u + 1);
        try {
          const fd = new FormData();
          fd.append("file", f);
          fd.append("kind", "inline");
          const r = await requestJson<{ url: string }>("/api/media/upload", {
            method: "POST",
            body: fd,
          });
          setImages((prev) => [...prev, r.url]);
        } catch (err) {
          if (isAuthError(err)) {
            toast.error(err instanceof Error ? err.message : t("common.error"));
          } else {
            toast.error(t("editor.uploadFail"));
          }
        } finally {
          setUploading((u) => u - 1);
        }
      }
    },
    [t],
  );

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      void uploadImages(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void uploadImages(files);
  }

  async function publish() {
    if (submitting || uploading > 0) return;
    const text = content.trim();
    if (!text && images.length === 0) return;
    setSubmitting(true);
    try {
      const full =
        images.length > 0
          ? `${text}${text ? "\n\n" : ""}${images.map((u) => `![](${u})`).join("\n\n")}`
          : text;
      await postJson("/api/posts", { type: "short", content: full, action: "submit" });
      setContent("");
      setImages([]);
      toast.success(t("feed.publish"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) router.push("/auth/login");
    } finally {
      setSubmitting(false);
    }
  }

  const canPublish = (content.trim().length > 0 || images.length > 0) && uploading === 0;

  return (
    <div
      className={cn(
        "border-b border-border bg-card p-4 transition-colors",
        dragOver && "bg-[var(--hover,#f7f8f8)] ring-2 ring-inset ring-primary/40",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex gap-3">
        <Avatar className="size-10">
          {viewer?.avatarPath && (
            <AvatarImage src={mediaUrl(viewer.avatarPath)} alt={viewer.displayName} />
          )}
          <AvatarFallback>{(viewer?.displayName ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={onPaste}
          placeholder={placeholder ?? t("feed.composePlaceholder")}
          className="min-h-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          maxLength={5000}
        />
      </div>

      {images.length > 0 && (
        <div className="ml-12 mt-1 flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={`${url}-${i}`} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(url)}
                alt=""
                className="size-20 rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                aria-label={t("common.delete")}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-sm"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 pl-12">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("editor.cover")}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-4" />
          </Button>
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              {t("editor.uploading")}
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          className="min-h-9"
          disabled={!canPublish || submitting}
          onClick={() => void publish()}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
          {t("feed.publish")}
        </Button>
      </div>
    </div>
  );
}
