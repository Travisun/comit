"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileText, Heart, MessageCircle, PenLine, RotateCcw, Trash2, ExternalLink, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterChips } from "@/components/admin/bits";
import { timeAgo } from "@/lib/utils";

/**
 * "我的文章" — rich-list management for the signed-in author: every item shows
 * content first (shorts render their text excerpt, articles render title +
 * excerpt) with status / stats / actions attached. Flat bordered rows,
 * Cloudflare-dashboard style.
 */

interface MyPost {
  id: string;
  type: "article" | "short";
  title: string | null;
  slug: string | null;
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
  const [status, setStatus] = useState<string>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "trash"
      ? "deleted"
      : "all",
  );
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MyPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<MyPost | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch(`/api/posts/mine?status=${status}&q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
    } catch {
      toast.error("加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      // normal delete → recycle bin (soft); purge → permanent removal
      const qs = deleting.status === "deleted" ? "?purge=true" : "";
      const res = await fetch(`/api/posts/${deleting.id}${qs}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(deleting.status === "deleted" ? "已彻底删除" : "已移入回收站");
      setDeleting(null);
      void load({ silent: true });
    } catch {
      toast.error("删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function restore(post: MyPost) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("已恢复为草稿");
      void load({ silent: true });
    } catch {
      toast.error("恢复失败");
    } finally {
      setBusy(false);
    }
  }

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
            disabled={busy}
            onClick={() => void restore(post)}
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
          {post.status === "published" && post.slug && (
            <Button asChild variant="ghost" size="icon-sm" title="查看">
              <a href={`/p/${post.id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
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

  const postMeta = (post: MyPost) => (
    <>
      <Badge variant={STATUS_META[post.status].badge}>{STATUS_META[post.status].label}</Badge>
      {post.type === "short" && <Badge variant="outline">动态</Badge>}
      {post.visibility === "followers" && <Badge variant="outline">仅关注者</Badge>}
    </>
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
            onChange={(e) => setQ(e.target.value)}
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
              {/* thumbnail: cover / first image / doc placeholder */}
              <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-[var(--muted)] text-muted-foreground">
                {post.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumb} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <FileText className="size-4" aria-hidden />
                )}
              </div>

              {/* main: two tight lines */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {post.type === "article"
                    ? post.title || "(无标题)"
                    : postExcerpt(post)}
                </p>
                {post.type === "article" && (
                  <p className="truncate text-xs text-muted-foreground">{postExcerpt(post)}</p>
                )}
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
              </div>

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
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "删除中…" : deleting?.status === "deleted" ? "彻底删除" : "移入回收站"}
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
