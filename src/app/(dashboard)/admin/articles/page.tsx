"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Eye, Heart, MessageSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  FilterChips,
  PageHeader,
  Pagination,
  PostStatusBadge,
  PostTypeBadge,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { PostRowActions } from "@/components/admin/post-actions";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

// 就地 zod schema：/api/admin/posts 响应无现成 schema，进缓存前校验把关
const postItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  type: z.enum(["article", "short"]),
  status: z.enum(["draft", "pending_review", "published", "rejected"]),
  views: z.number(),
  likeCount: z.number(),
  commentCount: z.number(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  rejectReason: z.string().nullable(),
  author: z.object({ username: z.string(), displayName: z.string() }),
});

const postsListSchema = z.object({
  items: z.array(postItemSchema),
  total: z.number(),
});

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "published", label: "已发布" },
  { value: "pending_review", label: "待审核" },
  { value: "rejected", label: "已驳回" },
  { value: "draft", label: "草稿" },
];

/** Fetches and renders one page of posts; keyed by filter state via queryKey. */
function ArticleList({
  status,
  query,
  offset,
  onPage,
}: {
  status: string;
  query: string;
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  // 列表查询 — key 随筛选/搜索/分页变化天然隔离（原 remount-by-key 防竞态
  // hack 已删）；placeholderData 让切换筛选时保留上一页数据不闪空
  const postsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminPosts(status, query, offset),
      url: `/api/admin/posts?${new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(status ? { status } : {}),
        ...(query ? { q: query } : {}),
      })}`,
      schema: postsListSchema,
      placeholderData: keepPreviousData,
    }),
  );
  const items = useMemo(() => postsQ.data?.items ?? [], [postsQ.data]);
  const total = postsQ.data?.total ?? 0;

  if (postsQ.error) return <EmptyState title="加载失败" hint={postsQ.error.message} />;
  if (postsQ.isPending) return <TableSkeleton rows={8} cols={6} />;
  if (items.length === 0)
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
          {items.map((p) => (
            <tr key={p.id}>
              <td className="max-w-72">
                <a
                  href={`/p/${p.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium text-foreground hover:underline"
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
              <td className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums">
                {timeAgo(p.publishedAt ?? p.createdAt, locale)}
              </td>
              <td className="text-right">
                <PostRowActions post={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Pagination
        offset={offset}
        limit={PAGE_SIZE}
        total={total}
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

  // debounce the search box; a new query resets pagination
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const onPage = (next: number) => setOffset(next);

  return (
    <div>
      <PageHeader title="文章管理" description="查看、审核与管理全站内容" />

      {/* toolbar: search + status filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / 作者…"
            className="pl-8"
          />
        </div>
        <FilterChips
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        />
      </div>

      <ArticleList status={status} query={query} offset={offset} onPage={onPage} />
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
