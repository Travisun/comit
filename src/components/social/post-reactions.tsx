"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SmilePlus } from "lucide-react";
import { routes } from "@/core/routes";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { isAuthError, requestJson } from "./api";
import { EmojiPopover } from "./composer-panels";

interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

/**
 * Discourse-style quick reactions on a post: existing reactions render as
 * count chips (tinted when the viewer reacted), and a smiley button opens
 * the emoji panel to add/toggle one. Placed next to the like button on post
 * pages. Anonymous visitors see the chips read-only; reacting requires
 * sign-in (redirects to login).
 */
export function PostReactions({ postId, className }: { postId: string; className?: string }) {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [items, setItems] = useState<ReactionSummary[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await requestJson<{ items: ReactionSummary[]; signedIn: boolean }>(
          `/api/posts/${postId}/reactions`,
        );
        if (!cancelled) {
          setItems(r.items);
          setSignedIn(r.signedIn);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const toggle = useCallback(
    async (emoji: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const r = await requestJson<{ items: ReactionSummary[] }>(
          `/api/posts/${postId}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          },
        );
        setItems(r.items);
      } catch (err) {
        if (isAuthError(err)) router.push(routes.login);
      } finally {
        setBusy(false);
      }
    },
    [busy, postId, router],
  );

  function onChipClick(emoji: string) {
    if (!signedIn) {
      router.push(routes.login);
      return;
    }
    void toggle(emoji);
  }

  // nothing to show for anonymous visitors until someone reacts
  if (items !== null && items.length === 0 && !signedIn) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {items?.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-pressed={r.mine}
          title={r.mine ? "点击取消" : "点击表态"}
          onClick={() => onChipClick(r.emoji)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
            r.mine
              ? "border-primary/50 bg-primary/10"
              : "border-border hover:bg-[var(--hover)]",
          )}
        >
          <span className="text-base leading-none">{r.emoji}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{r.count}</span>
        </button>
      ))}
      {signedIn && (
        <EmojiPopover label={zh ? "表态" : "React"} onPick={(emoji) => void toggle(emoji)}>
          <SmilePlus className="size-[18px]" />
        </EmojiPopover>
      )}
    </div>
  );
}
