"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Eye, Heart, MessageCircle, PenLine, RotateCcw, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterChips } from "@/components/admin/bits";
import { subscribeNoop, timeAgo } from "@/lib/utils";
import { apiGet, deleteJson, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { routes } from "@/core/routes";

/**
 * "我的文章" — rich-list management for the signed-in author: every item shows
 * content first (shorts render their text excerpt, articles render title +
 * excerpt) with status / stats / actions attached. Flat bordered rows,
 * Cloudflare-dashboard style.
 */

interface MyPost {
  id: string;
  publicId: string;
  type: "article" | "short";
  title: string | null;
  summary: string;
  excerpt: string;
  thumb: string | null;
  label: string;
  status: "draft" | "pending_review" | "published" | "rejected" | "deleted";
  visibility: "public" | "followers";
  views: number;
  likeCount: number;
  commentCount: number;
  rejectReason: string | null;
  publishedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  preDeleteStatus: string | null;
}

const STATUS_DOT: Record<MyPost["status"], string> = {
  published: "var(--success)",
  pending_review: "var(--warning)",
  draft: "var(--muted-foreground)",
  rejected: "var(--destructive)",
  deleted: "var(--muted-foreground)",
};

const STATUS_META: Record<MyPost["status"], { label: string; badge: "secondary" | "warning" | "success" | "destructive" }> = {
  draft: { label: "草稿", badge: "secondary" },
  pending_review: { label: "审核中", badge: "warning" },
  published: { label: "已发布", badge: "success" },
  rejected: { label: "被驳回", badge: "destructive" },
  deleted: { label: "回收站", badge: "secondary" },
};

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "published", label: "已发布" },
  { id: "draft", label: "草稿" },
  { id: "pending_review", label: "审核中" },
  { id: "rejected", label: "被驳回" },
  { id: "deleted", label: "回收站" },
] as const;

export function MyPostsManager() {
  // 初始 tab：水合期用服务端可预测默认值 "all"（getServerSnapshot），挂载后
  // useSyncExternalStore 自动切到客户端快照读取的 ?tab=trash —— 既避免
  // typeof window 分支的水合不匹配，也不在 effect 里手动 setState
  const initialTab = useSyncExternalStore(
    subscribeNoop,
    () => (new URLSearchParams(window.location.search).get("tab") === "trash" ? "deleted" : "all"),
    () => "all",
  );
  const [status, setStatus] = useState<string>(initialTab);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<MyPost | null>(null);

  // 列表查询 — key 随筛选/搜索变化；placeholderData 让切换页签时保留上一页数据
  const postsQ = useQuery({
    queryKey: queryKeys.myPostList(status, q),
    queryFn: async () => {
      const json = await apiGet<{ items?: MyPost[]; total?: number }>(
        `/api/posts/mine?status=${status}&q=${encodeURIComponent(q)}`,
      );
      return { items: json.items ?? [], total: json.total ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => postsQ.data?.items ?? [], [postsQ.data]);
  const total = postsQ.data?.total ?? 0;
  const loading = postsQ.isLoading;

  // 搜索防抖：输入先入 qInput，300ms 后同步到 q（驱动 queryKey 重新查询）
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput), qInput ? 300 : 0);
    return () => clearTimeout(timer);
  }, [qInput]);

  // 删除（软删/彻底删）— 失效整个管理列表家族；silent 保持原失败文案
  const deleteMutation = useApiMutation(
    (post: MyPost) => {
      // normal delete → recycle bin (soft); purge → permanent removal
      const qs = post.status === "deleted" ? "?purge=true" : "";
      return deleteJson(`/api/posts/${post.id}${qs}`);
    },
    {
      // 保持原行为等价：只失效列表查询，不触发 RSC 回流
      refresh: false,
      invalidate: [queryKeys.myPostListPrefix()],
      silent: true,
      onError: () => toast.error("删除失败"),
      onSuccess: (_data, post) => {
        toast.success(post.status === "deleted" ? "已彻底删除" : "已移入回收站");
        setDeleting(null);
      },
    },
  );

  // 恢复为草稿 — 同上，按前缀批量失效
  const restoreMutation = useApiMutation(
    (postId: string) => postJson(`/api/posts/${postId}/restore`, {}),
    {
      refresh: false,
      invalidate: [queryKeys.myPostListPrefix()],
      successToast: "已恢复为草稿",
      silent: true,
      onError: () => toast.error("恢复失败"),
    },
  );

  const stats = useMemo(() => {
    const pub = items.filter((i) => i.status === "published");
    return {
      views: items.reduce((s, i) => s + i.views, 0),
      likes: items.reduce((s, i) => s + i.likeCount, 0),
      comments: items.reduce((s, i) => s + i.commentCount, 0),
      published: pub.length,
    };
  }, [items]);

  const rowActions = (post: MyPost) => (
    <div className="flex shrink-0 items-center gap-1">
      {post.status === "deleted" ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={restoreMutation.pending}
            onClick={() => void restoreMutation.mutate(post.id)}
          >
            <RotateCcw className="size-3.5" /> 恢复
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="彻底删除"
            aria-label="彻底删除"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleting(post)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <Button asChild variant="ghost" size="icon-sm" title="编辑">
            <Link href={`/write/${post.id}`}>
              <PenLine className="size-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="移入回收站"
            aria-label="移入回收站"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleting(post)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );

  const postTime = (post: MyPost) => {
    if (post.status === "deleted" && post.deletedAt) return `删除于 ${timeAgo(post.deletedAt, "zh")}`;
    return post.status === "published" && post.publishedAt
      ? `发布于 ${timeAgo(post.publishedAt, "zh")}`
      : `更新于 ${timeAgo(post.updatedAt, "zh")}`;
  };

  /** rich-list excerpt: shorts show their text; articles prefer the summary */
  const postExcerpt = (post: MyPost) => {
    const text = post.type === "short" ? post.excerpt : post.summary || post.excerpt;
    const trimmed = text.trim();
    if (trimmed) return trimmed;
    return post.type === "short" ? "（图片动态）" : "（无文字内容）";
  };

  return (
    <div className="space-y-4">
      {/* filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
          value={status}
          onChange={setStatus}
        />
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="搜索标题或正文…"
            className="pl-8"
          />
        </div>
      </div>

      {/* stats strip (current filter scope) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="内容数" value={total} />
        <Stat label="浏览" value={stats.views} icon={<Eye className="size-3.5" />} />
        <Stat label="获赞" value={stats.likes} icon={<Heart className="size-3.5" />} />
        <Stat label="评论" value={stats.comments} icon={<MessageCircle className="size-3.5" />} />
      </div>

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center rounded-lg bg-[var(--muted)] py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
        </div>
      ) : items.length === 0 ? (
        status === "deleted" ? (
          <div className="rounded-lg bg-[var(--muted)] py-16 text-center">
            <p className="text-sm text-muted-foreground">回收站是空的。</p>
          </div>
        ) : (
          <div className="rounded-lg bg-[var(--muted)] py-16 text-center">
            <p className="text-sm text-muted-foreground">这里还什么都没有。</p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/write">
                <PenLine className="size-3.5" /> 写第一篇
              </Link>
            </Button>
          </div>
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {items.map((post) => (
            <li
              key={post.id}
              className="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--hover)]"
            >
              {/* whole item links to the detail page (works for shorts and
                  articles alike) — 简洁排版：标题 + 摘要 + meta，无缩略图 */}
              <Link
                href={routes.post(post.publicId)}
                className="flex min-w-0 flex-1 flex-col gap-0.5"
                title="查看详情"
              >
                <p className="truncate text-sm font-medium text-foreground group-hover:underline">
                  {post.type === "article" ? post.title || "(无标题)" : postExcerpt(post)}
                </p>
                {post.type === "article" && post.summary && (
                  <p className="truncate text-xs text-muted-foreground">{post.summary || postExcerpt(post)}</p>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: STATUS_DOT[post.status] }}
                      aria-hidden
                    />
                    {STATUS_META[post.status].label}
                  </span>
                  <span className="shrink-0">{post.type === "short" ? "动态" : "文章"}</span>
                  {post.visibility === "followers" && <span className="shrink-0">仅关注者</span>}
                  {post.rejectReason && (
                    <span className="truncate text-destructive">驳回:{post.rejectReason}</span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums">{postTime(post)}</span>
                  <span className="hidden shrink-0 items-center gap-2 tabular-nums sm:flex">
                    <span className="inline-flex items-center gap-0.5"><Eye className="size-3" />{post.views}</span>
                    <span className="inline-flex items-center gap-0.5"><Heart className="size-3" />{post.likeCount}</span>
                    <span className="inline-flex items-center gap-0.5"><MessageCircle className="size-3" />{post.commentCount}</span>
                  </span>
                </div>
              </Link>

              {/* actions — hover reveal on desktop, always visible on touch */}
              <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                {rowActions(post)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleting?.status === "deleted" ? "彻底删除这篇内容？" : "删除这篇内容？"}
            </DialogTitle>
            <DialogDescription>
              {deleting?.status === "deleted"
                ? `「${deleting?.title || "(无标题)"}」将被永久删除，包括全部评论与点赞数据。此操作不可恢复。`
                : `「${deleting?.title || "(无标题)"}」将移入回收站，随时可以恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void deleteMutation.mutate(deleting);
              }}
              disabled={deleteMutation.pending}
            >
              {deleteMutation.pending ? "删除中…" : deleting?.status === "deleted" ? "彻底删除" : "移入回收站"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
