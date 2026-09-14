"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Heart, MessageCircle, PenLine, RotateCcw, Trash2, ExternalLink, Search, Loader2 } from "lucide-react";
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
    <div className="flex shrink-0 items-center justify-end gap-1.5">
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
              <Link href={`/p/${post.id}`} target="_blank">
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" title="编辑">
            <Link href={`/write/${post.id}`}>
              <PenLine className="size-3.5" /> 编辑
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="删除"
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
            <li key={post.id} className="p-4 transition-colors hover:bg-[var(--hover)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {postMeta(post)}
                    <span className="text-xs text-muted-foreground">{postTime(post)}</span>
                  </div>

                  {/* rich info: articles lead with their title; shorts go
                      straight to the content excerpt */}
                  {post.type === "article" && (
                    <p className="mt-1.5 truncate text-[15px] font-semibold">
                      {post.title || "(无标题)"}
                    </p>
                  )}
                  {post.rejectReason ? (
                    <p className="mt-1 line-clamp-1 text-xs text-destructive">
                      驳回原因:{post.rejectReason}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {postExcerpt(post)}
                  </p>
                </div>

                {/* preview thumbnail link (published) */}
                {post.status === "published" && post.slug && (
                  <Link
                    href={`/p/${post.id}`}
                    target="_blank"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
                  >
                    查看
                  </Link>
                )}
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span className="inline-flex items-center gap-1"><Eye className="size-3" />{post.views}</span>
                  <span className="inline-flex items-center gap-1"><Heart className="size-3" />{post.likeCount}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" />{post.commentCount}</span>
                </span>
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
