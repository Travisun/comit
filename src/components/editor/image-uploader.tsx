"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { mediaUrl, uploadImage } from "./upload";

/**
 * Featured-image / cover uploader: click or drag to upload (kind featured|cover),
 * shows preview + progress, with a remove button. `value` is the media path
 * (or any URL); `onChange(null)` on remove.
 */
export function ImageUploader({
  kind,
  value,
  onChange,
  hint,
  className,
}: {
  kind: "featured" | "cover";
  value?: string | null;
  onChange: (path: string | null) => void;
  hint?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // local blob during upload

  const url = mediaUrl(value);

  const startUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("editor.uploadFail"));
      return;
    }
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    try {
      const res = await uploadImage(file, kind, setProgress);
      onChange(res.path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("editor.uploadFail"));
    } finally {
      setProgress(null);
      setPreview(null);
    }
  };

  const busy = progress !== null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {url || preview ? (
        <div className="group relative overflow-hidden rounded-lg border border-border">
          {/* plain <img> — media is served pre-optimized via /api/media/file */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview ?? url ?? undefined} alt="" className="aspect-[2/1] w-full object-cover" />
          <button
            type="button"
            aria-label={t("post.delete")}
            disabled={busy}
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 rounded-md border border-border bg-background/90 p-1.5 transition-opacity hover:bg-background disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
          {busy && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-background/90 px-3 py-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {progress}%
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
            if (file) void startUpload(file);
          }}
          className={cn(
            "flex aspect-[2/1] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-muted/50 text-foreground",
          )}
        >
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">{progress}%</span>
            </>
          ) : (
            <>
              <ImagePlus className="size-5" />
              <span className="text-xs">{t("editor.coverHint")}</span>
            </>
          )}
        </button>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void startUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
