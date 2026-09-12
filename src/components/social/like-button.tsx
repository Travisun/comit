"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { postJson } from "./api";

export function LikeButton({
  targetType,
  targetId,
  initialCount,
  initialLiked,
  className,
}: {
  targetType: "post" | "comment";
  targetId: string;
  initialCount: number;
  initialLiked: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    // optimistic
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const r = await postJson<{ liked: boolean; count: number }>("/api/likes", {
        targetType,
        targetId,
      });
      setLiked(r.liked);
      setCount(r.count);
    } catch (err) {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      title={liked ? t("post.unlike") : t("post.like")}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500",
        "disabled:pointer-events-none disabled:opacity-60",
        liked && "text-rose-500 hover:text-rose-500",
        className,
      )}
    >
      <Heart className={cn("size-4 shrink-0", liked && "fill-current")} />
      {count > 0 ? (
        <span className="tabular-nums">{count}</span>
      ) : (
        <span className="hidden sm:inline">{t("post.like")}</span>
      )}
    </button>
  );
}
