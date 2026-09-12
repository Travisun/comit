"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { routes } from "@/core/routes";
import { cn, readingMinutes } from "@/lib/utils";
import { isHttpUrl } from "@/lib/content-labels";
import { AnnotationBadge } from "@/components/posts/annotation-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "./markdown-editor";
import { BlockedDialog } from "./blocked-dialog";

/**
 * Short-post composer (/write?type=short): one big markdown textarea with
 * paste / drag-drop image upload, no title. A lightweight content-label chip
 * row (original / repost / opinion) sits above the editor; picking repost
 * reveals a compact source-URL input. Publishing runs action:'submit';
 * on success the user is returned to the feed.
 */

/** Labels offered in the lightweight short-post chips. */
const SHORT_LABELS = ["original", "repost", "opinion"] as const;

export function ShortPostEditor() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [label, setLabel] = useState<(typeof SHORT_LABELS)[number]>("original");
  const [sourceUrl, setSourceUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);

  const publish = async () => {
    if (!content.trim()) {
      toast.error(t("editor.shortPlaceholder"));
      return;
    }
    if (label === "repost" && !isHttpUrl(sourceUrl)) {
      toast.error("转载内容需填写原文地址（http(s)://…） / Reposts require a valid source URL");
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "short",
          content,
          label,
          ...(label === "repost" ? { sourceUrl: sourceUrl.trim() } : {}),
          action: "submit",
        }),
      });
      const data = (await res.json()) as { error?: string; blocked?: string[] };
      if (res.status === 422 && Array.isArray(data.blocked)) {
        setBlocked(data.blocked);
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? t("common.error"));
        return;
      }
      toast.success(t("editor.publish"));
      router.push(routes.home);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6 lg:p-8">
      <h1 className="mb-4 text-xl font-bold tracking-tight">{t("editor.shortMode")}</h1>

      {/* lightweight content-label chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SHORT_LABELS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={publishing}
            onClick={() => setLabel(id)}
            aria-pressed={label === id}
            className={cn(
              "rounded-md border p-1 transition-colors",
              label === id
                ? "border-primary bg-primary/5"
                : "border-border bg-[var(--muted)] opacity-60 hover:opacity-100",
            )}
          >
            <AnnotationBadge label={id} size="sm" />
          </button>
        ))}
      </div>
      {label === "repost" && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg bg-[var(--muted)] p-3 sm:flex-row">
          <Input
            type="url"
            inputMode="url"
            disabled={publishing}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder={locale === "zh" ? "原文地址（必填）https://…" : "Source URL (required) https://…"}
            className="flex-1"
            maxLength={2048}
          />
        </div>
      )}

      <MarkdownEditor
        value={content}
        onChange={setContent}
        compact
        placeholder={t("editor.shortPlaceholder")}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {content.replace(/\s+/g, "").length} · {t("editor.readingTime")} {readingMinutes(content)}
        </span>
        <Button disabled={publishing || !content.trim()} onClick={() => void publish()}>
          {publishing ? <Loader2 className="animate-spin" /> : null}
          {t("editor.publish")}
        </Button>
      </div>
      <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
    </div>
  );
}
