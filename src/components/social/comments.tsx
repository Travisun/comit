"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { BadgeCheck, Loader2, Lock, MessageCircle, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
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
import { CommentMenu } from "./comment-menu";
import { patchJsonSafe } from "@/lib/client/api";
import { openLoginDialog } from "@/lib/store/login-dialog";
import { GuestComposerPlaceholder } from "@/components/social/login-dialog";
import { PinnedComposer } from "@/components/social/pinned-composer";
import { ShortContent } from "@/components/social/short-content";

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
  viewer,
}: {
  postId: string;
  disabled: boolean;
  initialCount: number;
  /** 当前观众 brief（composer 头像/署名）；匿名 null */
  viewer?: { displayName: string; username: string; avatarPath: string | null } | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewerBrief = viewer
    ? { displayName: viewer.displayName, username: viewer.username, avatarPath: viewer.avatarPath }
    : null;
  const [count, setCount] = useState(initialCount);
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

  // 置顶楼层（独立列表）：始终渲染在列表最上方，不随分页漂移
  const pinnedQ = useQuery({
    queryKey: queryKeys.commentsPinned(postId),
    queryFn: async () =>
      commentsPageSchema.parse(await apiGet<unknown>(`${commentsUrl(postId)}&list=pinned&limit=5`)),
    enabled: !disabled,
    staleTime: 15_000,
  });
  // 解决方案摘要盒已上移至帖子主内容区（components/social/solutions-box.tsx，
  // post-view / short-post-detail 渲染），评论区不再重复展示。

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
      postJson<CommentItem>("/api/comments", { ...input, postId }),
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
        // 审核模式下 pending 评论不计入公开计数（与后端 commentCount 推迟自增一致）
        if (created.status !== "pending_review") setCount((c) => c + 1);
        if (created.status === "pending_review") {
          toast.success("评论已提交，审核通过后其他人可见");
        }
        setReplyTo(null);
        setViewerOverride((v) => v ?? "signed-in");
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
        // 置顶块/解决方案盒（前缀键）一并失效，删除的楼层不会残留在顶部
        void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
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



  function remove(id: string) {
    if (!window.confirm(t("post.deleteConfirm"))) return;
    removeMutation.mutate(id);
  }

  /** 单条评论渲染（置顶块与主流列表共用同一份 DOM/交互） */
  const renderItem = (c: CommentItem) => (
            <div
              key={c.id}
              id={`comment-${c.id}`}
              className={cn(
                "relative flex gap-3 rounded-lg px-2 py-2 transition-colors scroll-mt-14",
                highlightId === c.id && "bg-[var(--selected)] ring-1 ring-primary/25",
              )}
            >
              {/* 右上角操作菜单：置顶/解决方案（博主）、可见性（本人）、删除（有权限者） */}
              {(c.canManage || c.mine || c.canDelete) && (
                <div className="absolute right-0 top-0 z-10">
                  <CommentMenu
                    comment={c}
                    onManage={(id, action) => void manage(id, action)}
                    onRemove={(id) => remove(id)}
                    onChanged={(next) => {
                      if (next.visibility === "private") setCount((n) => Math.max(0, n - 1));
                      else if (next.visibility === "public" && c.visibility === "private") setCount((n) => n + 1);
                      // 可见性变化会影响公共列表/摘要位 → 前缀失效一并回拉
                      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(postId) });
                    }}
                  />
                </div>
              )}
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
                  {c.status === "pending_review" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      审核中 · 仅自己可见
                    </span>
                  )}
                  {c.status === "rejected" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                      未通过审核 · 仅自己可见
                    </span>
                  )}
                  {c.visibility === "private" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Lock className="size-2.5" aria-hidden /> 仅自己可见
                    </span>
                  )}
                </div>
                {/* 正文：解决方案仅以徽标标记（不在评论区做内容高亮，摘要在主内容区） */}
                <div className="reading-serif mt-0.5 text-sm leading-relaxed">
                  <ShortContent content={c.body} className="text-sm text-foreground/90" />
                </div>
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
                </div>
              </div>
            </div>
  );

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
        <button type="button" onClick={openLoginDialog} className="w-full text-left">
          <GuestComposerPlaceholder label={t("comments.placeholder")} />
        </button>
      ) : null}

      {/* 新评论气泡：增量拉取后先提示，点击并入 */}
      {pendingNew.length > 0 && (
        <button
          type="button"
          onClick={loadPending}
          className="sticky top-12 z-20 flex w-full items-center justify-center gap-1.5 border-b border-border bg-[var(--primary)] py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <span className="num font-semibold">{pendingNew.length}</span> 条新评论 · 点击查看
        </button>
      )}

      {/* 置顶楼层：始终渲染在列表最上方（主流已排除置顶，不会重复） */}
      {(pinnedQ.data?.items.length ?? 0) > 0 && (
        <div className="mb-2 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.03]">
          <div className="flex items-center gap-1.5 border-b border-primary/15 px-3 py-1.5 text-xs font-medium text-primary">
            <Pin className="size-3" aria-hidden /> 置顶评论
          </div>
          <div className="space-y-1">
            {pinnedQ.data!.items.map((pc) => renderItem(pc))}
          </div>
        </div>
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
          items.map((c) => renderItem(c))
        )}
      </div>

      {/* infinite scroll sentinel */}
      <div ref={sentinelRef} />
      {commentsQ.isFetchingNextPage && (
        <div className="flex justify-center py-3">
          <Loader2 className={cn("size-4 animate-spin text-muted-foreground")} />
        </div>
      )}

      {/* sticky reply bar — 与主发布器同一组件（comment 变体：隐藏发布特性） */}
      {!disabled && viewerId && (
        <PinnedBar>
          <PinnedComposer
            variant="comment"
            user={viewerBrief ?? { displayName: "你", username: "me", avatarPath: null }}
            commentPlaceholder={t("comments.placeholder")}
            replyToUsername={replyTo?.user.username ?? null}
            onCancelReply={() => setReplyTo(null)}
            onSubmitComment={async (text) => {
              submitMutation.mutate({ body: text, replyToCommentId: replyTo?.id });
              setReplyTo(null);
              return true;
            }}
          />
        </PinnedBar>
      )}
    </section>
  );
}
