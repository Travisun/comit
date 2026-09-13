"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, Send, Smile, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { isAuthError, mediaUrl, postJson, requestJson } from "./api";
import { LikeButton } from "./like-button";
import { PinnedBar } from "./pinned-bar";
import { EmojiPopover, insertAtCursor } from "./composer-panels";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  likeCount: number;
  liked?: boolean;
  mine?: boolean;
  canDelete?: boolean;
  user: { username: string; displayName: string; avatarPath: string | null };
  replyToCommentId: string | null;
  replyToUsername: string | null;
}

interface CommentsResponse {
  items: CommentItem[];
  nextCursor: string | null;
  viewerId: string | null;
}

export function Comments({
  postId,
  disabled,
  initialCount,
}: {
  postId: string;
  disabled: boolean;
  initialCount: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** undefined = unknown (initial load), null = anonymous, string = signed in */
  const [viewerId, setViewerId] = useState<string | null | undefined>(undefined);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-grow the reply bar's textarea (capped, then it scrolls)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body]);

  // comment intent: focus the reply bar once it mounts (retry through the
  // portal mount + viewer resolution)
  useEffect(() => {
    if (disabled) return;
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        return;
      }
      if (++tries < 60) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [disabled]);

  function startReply(c: CommentItem) {
    setReplyTo(c);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const load = useCallback(
    async (cursor?: string | null) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const qs = new URLSearchParams({ postId, limit: "10" });
        if (cursor) qs.set("cursor", cursor);
        const r = await requestJson<CommentsResponse>(`/api/comments?${qs.toString()}`);
        setItems((prev) => {
          if (cursor) {
            const seen = new Set((prev ?? []).map((c) => c.id));
            return [...(prev ?? []), ...r.items.filter((c) => !seen.has(c.id))];
          }
          return r.items;
        });
        setNextCursor(r.nextCursor);
        setViewerId(r.viewerId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("common.error"));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [postId, t],
  );

  // initial page — async IIFE so no setState happens synchronously in the effect
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ postId, limit: "10" });
        const r = await requestJson<CommentsResponse>(`/api/comments?${qs.toString()}`);
        if (cancelled) return;
        setItems(r.items);
        setNextCursor(r.nextCursor);
        setViewerId(r.viewerId);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t("common.error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, t]);

  // infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingRef.current) {
          void load(nextCursor);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, load]);

  async function submit() {
    const text = body.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const created = await postJson<CommentItem>("/api/comments", {
        postId,
        body: text,
        replyToCommentId: replyTo?.id,
      });
      setItems((prev) => [created, ...(prev ?? [])]);
      setCount((c) => c + 1);
      setBody("");
      setReplyTo(null);
      setViewerId((v) => v ?? "signed-in");
      inputRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) router.push("/auth/login");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return; // newline
    // IME composition (Chinese input) — never submit mid-composition
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/⌘+Enter → explicit newline
      insertAtCursor(inputRef.current, "\n", body, setBody);
      return;
    }
    void submit();
  }

  async function remove(id: string) {
    if (!window.confirm(t("post.deleteConfirm"))) return;
    try {
      await requestJson(`/api/comments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setItems((prev) => (prev ?? []).filter((c) => c.id !== id));
      setCount((c) => Math.max(0, c - 1));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  return (
    <section className="mt-6" aria-label={t("comments.title")}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageCircle className="size-4" />
        {t("comments.title")}
        {count > 0 && <span className="text-muted-foreground tabular-nums">({count})</span>}
      </h2>

      {/* composer states — the input itself is the sticky bar at the bottom */}
      {disabled ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          {t("comments.disabled")}
        </p>
      ) : viewerId === null ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            {t("nav.login")}
          </Link>
          {" — "}
          {t("comments.placeholder")}
        </p>
      ) : null}

      {/* list */}
      <div className="mt-4 space-y-1">
        {items === null ? (
          <div className="space-y-4 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("comments.empty")}</p>
        ) : (
          items.map((c) => (
            <div key={c.id} className="flex gap-3 rounded-lg px-1 py-3">
              <Link href={`/u/${c.user.username}`} className="shrink-0" aria-label={c.user.displayName}>
                <Avatar className="size-9 border border-border">
                  {c.user.avatarPath && (
                    <AvatarImage src={mediaUrl(c.user.avatarPath)} alt={c.user.displayName} />
                  )}
                  <AvatarFallback>
                    {c.user.displayName.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <Link
                    href={`/u/${c.user.username}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {c.user.displayName}
                  </Link>
                  {c.replyToUsername && (
                    <span className="text-xs text-muted-foreground">
                      {t("comments.replyTo")} @{c.replyToUsername}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(c.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                  {c.body}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <LikeButton
                    targetType="comment"
                    targetId={c.id}
                    initialCount={c.likeCount}
                    initialLiked={Boolean(c.liked)}
                  />
                  {!disabled && viewerId && (
                    <button
                      type="button"
                      onClick={() => startReply(c)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {t("comments.reply")}
                    </button>
                  )}
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(c.id)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* infinite scroll sentinel */}
      <div ref={sentinelRef} />
      {loading && items !== null && (
        <div className="flex justify-center py-3">
          <Loader2 className={cn("size-4 animate-spin text-muted-foreground")} />
        </div>
      )}

      {/* sticky reply bar (Douyin-style) — pinned panel-wide via PinnedBar,
          so it stays within reach even while scrolling long article bodies */}
      {!disabled && viewerId && (
        <PinnedBar>
          <div className="rounded-2xl border border-border bg-card/95 p-2 shadow-[0_4px_16px_rgba(42,47,69,0.12)] backdrop-blur">
            {replyTo && (
              <div className="mb-1.5 flex items-center justify-between rounded-lg bg-[var(--muted)] px-2.5 py-1 text-xs text-muted-foreground">
                <span>
                  {t("comments.replyTo")} @{replyTo.user.username}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="rounded p-0.5 hover:text-foreground"
                  aria-label={t("common.cancelAction")}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <EmojiPopover label={locale === "zh" ? "表情" : "Emoji"} onPick={(emoji) => insertAtCursor(inputRef.current, emoji, body, setBody)}>
                <Smile className="size-[18px]" aria-hidden />
              </EmojiPopover>
              <Textarea
                ref={inputRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  replyTo
                    ? `${t("comments.replyTo")} @${replyTo.user.username}`
                    : t("comments.placeholder")
                }
                maxLength={2000}
                rows={1}
                className="max-h-40 min-h-9 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:shadow-none"
              />
              <Button
                type="button"
                size="icon-sm"
                aria-label={t("comments.submit")}
                title="Enter 发送 · Shift/Ctrl+Enter 换行"
                className="mb-0.5 shrink-0 rounded-full"
                disabled={!body.trim() || submitting}
                onClick={() => void submit()}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        </PinnedBar>
      )}
    </section>
  );
}
