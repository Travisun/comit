"use client";

import Link from "next/link";
import {
  DataTable,
  DataTableRow,
  DataTableTd,
  DataTableTh,
} from "@/components/ui/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Heart, MessageCircle, PenLine, Trash2, ExternalLink, Search, Loader2 } from "lucide-react";
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
 * Dashboard "我的文章" — full lifecycle management for the signed-in author:
 * drafts / pending review / published / rejected, with stats and edit / view /
 * delete actions. Cloudflare-dashboard flat style: chip filters, stat cards,
 * a bordered table on desktop (rows separated by 1px, hover wash, right-aligned
 * actions) and compact cards on mobile.
 */

interface MyPost {
  id: string;
  type: "article" | "short";
  title: string | null;
  slug: string | null;
  summary: string;
  label: string;
  status: "draft" | "pending_review" | "published" | "rejected";
  visibility: "public" | "followers";
  views: number;
  likeCount: number;
  commentCount: number;
  rejectReason: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

const STATUS_META: Record<MyPost["status"], { label: string; badge: "secondary" | "warning" | "success" | "destructive" }> = {
  draft: { label: "草稿", badge: "secondary" },
  pending_review: { label: "审核中", badge: "warning" },
  published: { label: "已发布", badge: "success" },
  rejected: { label: "被驳回", badge: "destructive" },
};

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "published", label: "已发布" },
  { id: "draft", label: "草稿" },
  { id: "pending_review", label: "审核中" },
  { id: "rejected", label: "被驳回" },
] as const;

export function MyPostsManager() {
  const [status, setStatus] = useState<string>("all");
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
      const res = await fetch(`/api/posts/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("已删除");
      setDeleting(null);
      void load({ silent: true });
    } catch {
      toast.error("删除失败");
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
    </div>
  );

  const postMeta = (post: MyPost) => (
    <>
      <Badge variant={STATUS_META[post.status].badge}>{STATUS_META[post.status].label}</Badge>
      {post.type === "short" && <Badge variant="outline">动态</Badge>}
      {post.visibility === "followers" && <Badge variant="outline">仅关注者</Badge>}
    </>
  );

  const postTime = (post: MyPost) =>
    post.status === "published" && post.publishedAt
      ? `发布于 ${timeAgo(post.publishedAt, "zh")}`
      : `更新于 ${timeAgo(post.updatedAt, "zh")}`;

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
        <div className="rounded-lg bg-[var(--muted)] py-16 text-center">
          <p className="text-sm text-muted-foreground">这里还什么都没有。</p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/write">
              <PenLine className="size-3.5" /> 写第一篇
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {/* desktop: flat table */}
          <DataTable>
              <thead>
                <tr>
                  <DataTableTh>标题</DataTableTh>
                  <DataTableTh>状态</DataTableTh>
                  <DataTableTh>数据</DataTableTh>
                  <DataTableTh className="text-right">时间</DataTableTh>
                  <DataTableTh className="w-44" />
                </tr>
              </thead>
              <tbody>
                {items.map((post) => (
                  <DataTableRow key={post.id}>
                    <DataTableTd className="max-w-80">
                      <span className="block truncate font-medium">
                        {post.title || (post.type === "short" ? "(短动态)" : "(无标题)")}
                      </span>
                      {post.rejectReason ? (
                        <span className="block truncate text-xs text-destructive" title={post.rejectReason}>
                          驳回原因:{post.rejectReason}
                        </span>
                      ) : null}
                    </DataTableTd>
                    <DataTableTd>{postMeta(post)}</DataTableTd>
                    <DataTableTd>
                      <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                        <span className="inline-flex items-center gap-1"><Eye className="size-3" />{post.views}</span>
                        <span className="inline-flex items-center gap-1"><Heart className="size-3" />{post.likeCount}</span>
                        <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" />{post.commentCount}</span>
                      </span>
                    </DataTableTd>
                    <DataTableTd className="whitespace-nowrap text-right text-xs text-muted-foreground">{postTime(post)}</DataTableTd>
                    <DataTableTd className="text-right">{rowActions(post)}</DataTableTd>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>

          {/* mobile: compact cards */}
          <ul className="space-y-2 md:hidden">
            {items.map((post) => (
              <li key={post.id} className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-col gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {postMeta(post)}
                      <span className="text-xs text-muted-foreground">{postTime(post)}</span>
                    </div>
                    <div className="mt-1.5 truncate text-sm font-semibold">
                      {post.title || (post.type === "short" ? "(短动态)" : "(无标题)")}
                    </div>
                    {post.rejectReason && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">驳回原因:{post.rejectReason}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Eye className="size-3" />{post.views}</span>
                      <span className="inline-flex items-center gap-1"><Heart className="size-3" />{post.likeCount}</span>
                      <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" />{post.commentCount}</span>
                    </div>
                  </div>
                  {rowActions(post)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这篇内容？</DialogTitle>
            <DialogDescription>
              「{deleting?.title || "(无标题)"}」将被永久删除，包括全部评论与点赞数据。此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "删除中…" : "确认删除"}
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
