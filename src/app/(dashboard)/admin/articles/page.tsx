"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, Heart, MessageSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  PageHeader,
  Pagination,
  PostStatusBadge,
  PostTypeBadge,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { PostRowActions } from "@/components/admin/post-actions";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface PostItem {
  id: string;
  title: string | null;
  type: "article" | "short";
  status: "draft" | "pending_review" | "published" | "rejected";
  views: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
  createdAt: string;
  rejectReason: string | null;
  author: { username: string; displayName: string };
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "published", label: "已发布" },
  { value: "pending_review", label: "待审核" },
  { value: "rejected", label: "已驳回" },
  { value: "draft", label: "草稿" },
];

/** Fetches and renders one page of posts; remounted (via key) on filter change. */
function ArticleList({
  status,
  query,
  offset,
  onChanged,
  onPage,
}: {
  status: string;
  query: string;
  offset: number;
  onChanged: () => void;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  const [data, setData] = useState<{ items: PostItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (status) params.set("status", status);
    if (query) params.set("q", query);
    api<{ items: PostItem[]; total: number }>(`/api/admin/posts?${params}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [status, query, offset, onChanged]);

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={8} cols={6} />;
  if (data.items.length === 0)
    return <EmptyState title="没有匹配的文章" hint="试试调整筛选条件或搜索词" />;

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th>标题</th>
            <th>作者</th>
            <th>类型</th>
            <th>状态</th>
            <th>数据</th>
            <th className="text-right">时间</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody>
          {data.items.map((p) => (
            <tr key={p.id}>
              <td className="max-w-72">
                <a
                  href={`/p/${p.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:underline"
                >
                  {p.title ?? "（无标题）"}
                </a>
                {p.status === "rejected" && p.rejectReason ? (
                  <span className="block truncate text-xs text-destructive" title={p.rejectReason}>
                    驳回原因：{p.rejectReason}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap text-muted-foreground">@{p.author.username}</td>
              <td>
                <PostTypeBadge type={p.type} />
              </td>
              <td>
                <PostStatusBadge status={p.status} />
              </td>
              <td>
                <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span className="flex items-center gap-1" title="浏览">
                    <Eye className="size-3.5" />
                    {p.views}
                  </span>
                  <span className="flex items-center gap-1" title="点赞">
                    <Heart className="size-3.5" />
                    {p.likeCount}
                  </span>
                  <span className="flex items-center gap-1" title="评论">
                    <MessageSquare className="size-3.5" />
                    {p.commentCount}
                  </span>
                </span>
              </td>
              <td className="whitespace-nowrap text-right text-xs text-muted-foreground">
                {timeAgo(p.publishedAt ?? p.createdAt, locale)}
              </td>
              <td className="text-right">
                <PostRowActions post={p} onChanged={onChanged} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination
        offset={offset}
        limit={PAGE_SIZE}
        total={data.total}
        onPage={onPage}
      />
    </>
  );
}

function ArticlesInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);

  // debounce the search box; a new query resets pagination
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const onPage = useCallback((next: number) => setOffset(next), []);

  return (
    <div>
      <PageHeader title="文章管理" description="查看、审核与管理全站内容" />

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / 作者…"
            className="pl-8"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
          className="h-9 rounded-lg border border-input bg-[var(--muted)] px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label="按状态筛选"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <ArticleList
        key={`${status}|${query}|${offset}|${version}`}
        status={status}
        query={query}
        offset={offset}
        onChanged={bump}
        onPage={onPage}
      />
    </div>
  );
}

export default function AdminArticlesPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
      <ArticlesInner />
    </Suspense>
  );
}
