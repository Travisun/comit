"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { BadgeCheck, Loader2, MessageCircle, Pin, Send, Smile, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { apiGet, deleteJson, isAuthError, mediaUrl, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import {
  commentsPageSchema,
  type CommentItem,
  type CommentsPage,
} from "@/lib/models/comments";
import { LikeButton } from "./like-button";
import { PinnedBar } from "./pinned-bar";
import { EmojiPopover, insertAtCursor } from "./composer-panels";
import { patchJsonSafe } from "@/lib/client/api";

export type { CommentItem };

const PAGE_LIMIT = "10";

function commentsUrl(postId: string, cursor?: string | null) {
  const qs = new URLSearchParams({ postId, limit: PAGE_LIMIT });
  if (cursor) qs.set("cursor", cursor);
  return `/api/comments?${qs.toString()}`;
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
  const queryClient = useQueryClient();
  const [count, setCount] = useState(initialCount);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  /** 提交成功后本地兜底（首个页面返回前即可显示回复框） */
  const [viewerOverride, setViewerOverride] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- 评论流：无限分页（TanStack Query 托管缓存与翻页状态） ----
  const commentsQ = useInfiniteQuery({
    queryKey: queryKeys.comments(postId),
    queryFn: async ({ pageParam }) =>
      commentsPageSchema.parse(await apiGet<unknown>(commentsUrl(postId, pageParam))),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: CommentItem[] = [];
    for (const page of commentsQ.data?.pages ?? []) {
      for (const c of page.items) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
    }
    return out;
  }, [commentsQ.data]);

  const viewerId = viewerOverride ?? commentsQ.data?.pages[0]?.viewerId;
  const initialLoaded = commentsQ.data !== undefined;

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

  // ---- 锚点定位：/#comment-<id> 访问时滚动到对应评论并短暂高亮 ----
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusAnchor = useCallback(() => {
    const m = window.location.hash.match(/^#comment-([A-Za-z0-9-]+)$/);
    if (!m) return;
    const target = document.getElementById(`comment-${m[1]}`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(m[1]);
    if (anchorTimer.current) clearTimeout(anchorTimer.current);
    anchorTimer.current = setTimeout(() => setHighlightId(null), 2400);
  }, []);

  // 首页数据到达后尝试定位；此后监听 hash 变化（点击时间戳锚点同样生效）。
  // rAF 延迟一帧：滚动与高亮都不在 effect 同步路径上触发 setState。
  useEffect(() => {
    if (!initialLoaded) return;
    const raf = requestAnimationFrame(focusAnchor);
    window.addEventListener("hashchange", focusAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", focusAnchor);
      if (anchorTimer.current) clearTimeout(anchorTimer.current);
    };
  }, [initialLoaded, focusAnchor]);

  // ---- 定时增量拉取新评论：先提示，点击后并入列表 ----
  const checkQ = useQuery({
    queryKey: queryKeys.commentsCheck(postId),
    queryFn: async () =>
      commentsPageSchema.parse(await apiGet<unknown>(commentsUrl(postId))),
    enabled: !disabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const pendingNew = useMemo(() => {
    const page = checkQ.data;
    if (!page) return [];
    const known = new Set(items.map((x) => x.id));
    return page.items.filter((x) => !known.has(x.id));
  }, [checkQ.data, items]);

  function loadPending() {
    queryClient.setQueryData<InfiniteData<CommentsPage>>(
      queryKeys.comments(postId),
      (prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((p, i) =>
                i === 0 ? { ...p, items: [...pendingNew, ...p.items] } : p,
              ),
            }
          : prev,
    );
    setCount((c) => c + pendingNew.length);
    requestAnimationFrame(focusAnchor);
  }

  // infinite scroll
  const fetchNextPage = commentsQ.fetchNextPage;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !commentsQ.hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !commentsQ.isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [commentsQ.hasNextPage, commentsQ.isFetchingNextPage, fetchNextPage]);

  // ---- 提交/删除（mutation 收编）：手写 busy 由 pending 承担；成功后保持
  // 原有的 setQueryData 增量插入/移除模式；静默失败自行 toast + 登录跳转 ----
  const submitMutation = useApiMutation(
    (input: { body: string; replyToCommentId?: string }) =>
      postJson<CommentItem>("/api/comments", input),
    {
      silent: true,
      refresh: false, // 评论区全量走查询缓存，无需 RSC 重验
      onSuccess: (created) => {
        queryClient.setQueryData<InfiniteData<CommentsPage>>(
          queryKeys.comments(postId),
          (prev) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((p, i) =>
                    i === 0 ? { ...p, items: [created, ...p.items] } : p,
                  ),
                }
              : prev,
        );
        setCount((c) => c + 1);
        setBody("");
        setReplyTo(null);
        setViewerOverride((v) => v ?? "signed-in");
        inputRef.current?.focus();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : t("common.error"));
        if (isAuthError(err)) router.push("/auth/login");
      },
    },
  );

  const removeMutation = useApiMutation(
    (id: string) => deleteJson(`/api/comments?id=${encodeURIComponent(id)}`),
    {
      silent: true,
      refresh: false,
      onSuccess: (_data, id) => {
        queryClient.setQueryData<InfiniteData<CommentsPage>>(
          queryKeys.comments(postId),
          (prev) =>
            prev
              ? {
                  ...prev,
                  pages: prev.pages.map((p) => ({
                    ...p,
                    items: p.items.filter((c) => c.id !== id),
                  })),
                }
              : prev,
        );
        setCount((c) => Math.max(0, c - 1));
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : t("common.error"));
      },
    },
  );

  /** 博主管理评论：置顶（单槽）/标记解决方案（可多个）— PATCH 后失效列表回拉 */
  async function manage(id: string, action: "pin" | "unpin" | "solve" | "unsolve") {
    const r = await patchJsonSafe(`/api/comments`, { id, action });
    if (!r.ok) {
      toast.error(r.error ?? t("common.error"));
      return;
    }
    toast.success(
      action === "pin"
        ? "已置顶"
        : action === "unpin"
          ? "已取消置顶"
          : action === "solve"
            ? "已标记为解决方案"
            : "已取消解决方案",
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
  }

  async function submit() {
    const text = body.trim();
    if (!text || submitMutation.pending) return;
    submitMutation.mutate({ body: text, replyToCommentId: replyTo?.id });
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

  function remove(id: string) {
    if (!window.confirm(t("post.deleteConfirm"))) return;
    removeMutation.mutate(id);
  }

  return (
    <section className="mt-6" aria-label={t("comments.title")}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-normal text-foreground">
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

      {/* 新评论气泡：增量拉取后先提示，点击并入 */}
      {pendingNew.length > 0 && (
        <button
          type="button"
          onClick={loadPending}
          className="sticky top-12 z-20 flex w-full items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-[0_2px_10px_rgba(42,47,69,0.1)] transition-colors hover:text-foreground"
        >
          <MessageCircle className="size-3.5" />
          <span className="num font-medium">{pendingNew.length}</span> 条新评论 · 点击查看
        </button>
      )}

      {/* list */}
      <div className="mt-4 space-y-1">
        {!initialLoaded ? (
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
            <div
              key={c.id}
              id={`comment-${c.id}`}
              className={cn(
                "flex gap-3 rounded-lg px-2 py-2 transition-colors scroll-mt-14",
                highlightId === c.id && "bg-[var(--selected)] ring-1 ring-primary/25",
              )}
            >
              <Link href={`/u/${c.user.username}`} className="shrink-0" aria-label={c.user.displayName}>
                <Avatar className="size-8 border border-border">
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
                  <a
                    href={`#comment-${c.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      history.replaceState(null, "", `#comment-${c.id}`);
                      focusAnchor();
                    }}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    title="复制或跳转到此评论"
                  >
                    {timeAgo(c.createdAt, locale)}
                  </a>
                  {(c.pinned || c.solution) && (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                      {c.pinned && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          <Pin className="size-2.5" aria-hidden /> 置顶
                        </span>
                      )}
                      {c.solution && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                          <BadgeCheck className="size-2.5" aria-hidden /> 解决方案
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "reading-serif mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed",
                    c.solution ? "rounded-lg border-l-2 border-emerald-500/50 bg-emerald-500/5 px-2 py-1 text-foreground/90" : "text-foreground/90",
                  )}
                >
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
                      className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {t("comments.reply")}
                    </button>
                  )}
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(c.id)}
                      className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}                  {c.canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => void manage(c.id, c.pinned ? "unpin" : "pin")}
                        className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pin className="size-3.5" />
                        {c.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void manage(c.id, c.solution ? "unsolve" : "solve")}
                        className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-emerald-600"
                      >
                        <BadgeCheck className="size-3.5" />
                        {c.solution ? "取消解决方案" : "解决方案"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* infinite scroll sentinel */}
      <div ref={sentinelRef} />
      {commentsQ.isFetchingNextPage && (
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
                disabled={!body.trim() || submitMutation.pending}
                onClick={() => void submit()}
              >
                {submitMutation.pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </PinnedBar>
      )}
    </section>
  );
}
