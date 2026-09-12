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
import { Loader2, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { isAuthError, mediaUrl, postJson, requestJson } from "./api";
import { LikeButton } from "./like-button";

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) router.push("/auth/login");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
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

      {/* composer */}
      {disabled ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          {t("comments.disabled")}
        </p>
      ) : viewerId === undefined ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : viewerId === null ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            {t("nav.login")}
          </Link>
          {" — "}
          {t("comments.placeholder")}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card p-3">
          {replyTo && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              <span>
                {t("comments.replyTo")} @{replyTo.user.username}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="rounded p-0.5 hover:text-foreground"
                aria-label={t("common.cancelAction")}
              >
                ×
              </button>
            </div>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("comments.placeholder")}
            maxLength={2000}
            rows={3}
            className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              className="min-h-9"
              disabled={!body.trim() || submitting}
              onClick={() => void submit()}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t("comments.submit")}
            </Button>
          </div>
        </div>
      )}

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
                      onClick={() => setReplyTo(c)}
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
    </section>
  );
}
