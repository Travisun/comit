"use client";

import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isAuthError, postJson } from "@/lib/client/api";

export function RepostButton({
  postId,
  initialCount,
  initialReposted,
  className,
}: {
  postId: string;
  initialCount: number;
  initialReposted: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const [reposted, setReposted] = useState(initialReposted);
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle(withComment?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson<{ reposted: boolean; count: number }>("/api/reposts", {
        postId,
        comment: withComment?.trim() ? withComment.trim() : undefined,
      });
      setReposted(r.reposted);
      setCount(r.count);
      setOpen(false);
      setComment("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function onClick() {
    if (reposted) {
      // already reposted → click cancels directly
      void toggle();
    } else {
      setOpen(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={reposted}
        title={reposted ? t("post.reposted") : t("post.repost")}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500",
        "disabled:pointer-events-none disabled:opacity-60",
        reposted && "text-emerald-600 hover:text-emerald-600",
        className,
      )}
      >
        <Repeat2 className="size-4 shrink-0" />
        {count > 0 ? (
          <span className="tabular-nums">{count}</span>
        ) : (
          <span className="hidden sm:inline">{t("post.repost")}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("post.repost")}</DialogTitle>
            <DialogDescription>{t("post.reposted")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder={t("feed.composePlaceholder")}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={() => void toggle(comment)} disabled={busy}>
              {t("post.repost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
