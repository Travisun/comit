"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { CalendarPlus, Copy, HardDrive, Images, Search, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/admin/post-actions";
import {
  EmptyState,
  FilterChips,
  PageHeader,
  Pagination,
  StatCard,
  TableSkeleton,
} from "@/components/admin/bits";
import { formatBytes, timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { deleteJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";

/* -------------------------------- schema --------------------------------- */

const mediaItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  path: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number(),
  width: z.number(),
  height: z.number(),
  kind: z.string(),
  alt: z.string(),
  createdAt: z.string(),
  ownerUsername: z.string(),
  ownerDisplayName: z.string(),
  ownerAvatar: z.string().nullable(),
});

const mediaPageSchema = z.object({
  items: z.array(mediaItemSchema),
  total: z.number(),
  stats: z.object({ files: z.number(), bytes: z.number(), monthFiles: z.number() }),
});

type MediaItem = z.infer<typeof mediaItemSchema>;

const PAGE_SIZE = 30;

/** 查询键 — keys.ts 冻结期内就地字面量（暂未入厂），类型/搜索/分页全进键。 */
const mediaKey = (kind: string, query: string, offset: number) =>
  ["admin", "media", kind, query, offset] as const;
/** 删除后按前缀失效全部筛选组合的列表（stats 随列表响应一起更新） */
const MEDIA_PREFIX = ["admin", "media"] as const;

const KIND_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "inline", label: "正文配图" },
  { value: "avatar", label: "头像" },
  { value: "cover", label: "封面" },
  { value: "featured", label: "精选" },
];

const KIND_LABELS: Record<string, string> = {
  inline: "正文配图",
  avatar: "头像",
  cover: "封面",
  featured: "精选",
};

function src(path: string): string {
  return `/api/media/file/${path}`;
}

/** Keyline white card — the only boxed surface on this page (Stripe Home stat). */
function StatTile({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-4">{children}</div>;
}

/** Fetches and renders one page of media; query key carries kind/query/offset. */
function MediaGrid({
  kind,
  query,
  offset,
  onPage,
}: {
  kind: string;
  query: string;
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);

  // 列表查询 — placeholderData 保留上一页数据，翻页/筛选不闪骨架
  const mediaQ = useQuery({
    ...apiQueryOptions({
      queryKey: mediaKey(kind, query, offset),
      url: `/api/admin/media?limit=${PAGE_SIZE}&offset=${offset}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
      schema: mediaPageSchema,
    }),
    placeholderData: keepPreviousData,
  });
  const data = mediaQ.data;
  const error = mediaQ.error instanceof Error ? mediaQ.error.message : null;

  // 删除媒体 — pending 驱动确认按钮；失效本页列表家族替代原 onChanged 重挂
  const deleteMutation = useApiMutation(
    (item: MediaItem) => deleteJson(`/api/admin/media/${item.id}`),
    {
      refresh: false,
      invalidate: [MEDIA_PREFIX],
      onSuccess: (_data, item) => {
        toast.success(`已删除 ${item.filename}`);
        setDeleting(null);
        setViewing(null);
      },
    },
  );

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={6} cols={4} />;
  if (data.items.length === 0)
    return <EmptyState title="没有匹配的媒体文件" hint="试试调整类型或搜索词" />;

  return (
    <>
      {/* stats — keyline white cards, no shadow */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile>
          <StatCard label="文件总数" value={data.stats.files} icon={<Images />} />
        </StatTile>
        <StatTile>
          <StatCard label="总占用空间" value={formatBytes(data.stats.bytes)} icon={<HardDrive />} />
        </StatTile>
        <StatTile>
          <StatCard label="本月新增" value={data.stats.monthFiles} icon={<CalendarPlus />} />
        </StatTile>
      </div>

      {/* grid — keyline card grid: 1px border white card + hairline footer strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.items.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setViewing(m)}
            className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:bg-[var(--hover)]"
          >
            <div className="relative aspect-square overflow-hidden bg-[var(--muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(m.path)}
                alt={m.alt || m.filename}
                loading="lazy"
                className="size-full object-cover transition-transform group-hover:scale-105"
              />
              <Badge variant="secondary" className="absolute left-2 top-2 px-1.5 py-0 text-[10px]">
                {KIND_LABELS[m.kind] ?? m.kind}
              </Badge>
            </div>
            <div className="min-w-0 space-y-0.5 border-t border-border px-3 py-2">
              <p className="truncate text-xs font-medium text-foreground">{m.filename}</p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {formatBytes(m.size)} · {m.width}×{m.height} · @{m.ownerUsername}
              </p>
              <p className="text-xs text-muted-foreground">{timeAgo(m.createdAt, locale)}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPage={onPage} />
      </div>

      {/* viewer */}
      <Dialog open={viewing !== null} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{viewing.filename}</DialogTitle>
                <DialogDescription>
                  {KIND_LABELS[viewing.kind] ?? viewing.kind} · {formatBytes(viewing.size)} ·{" "}
                  {viewing.width}×{viewing.height}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(viewing.path)}
                alt={viewing.alt || viewing.filename}
                className="max-h-[55vh] w-full rounded-lg border border-border object-contain"
              />
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  归属：
                  <a
                    href={`/u/${viewing.ownerUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground hover:underline"
                  >
                    {viewing.ownerDisplayName} (@{viewing.ownerUsername})
                  </a>
                </p>
                <p>
                  上传时间：
                  {new Date(viewing.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}
                </p>
                <p className="break-all font-mono text-xs">/api/media/file/{viewing.path}</p>
              </div>
              <DialogFooter className="sm:justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`${location.origin}${src(viewing.path)}`)
                      .then(() => toast.success("链接已复制"))
                      .catch(() => toast.error("复制失败"));
                  }}
                >
                  <Copy />
                  复制链接
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteMutation.pending}
                  onClick={() => {
                    setViewing(null);
                    setDeleting(viewing);
                  }}
                >
                  <Trash2 />
                  删除文件
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title="删除该媒体文件？"
        description={
          deleting
            ? `「${deleting.filename}」将从磁盘移除；引用它的文章/头像将显示为裂图，请确认没有正在使用。`
            : undefined
        }
        confirmText="确认删除"
        destructive
        pending={deleteMutation.pending}
        onConfirm={() => {
          if (deleting) void deleteMutation.mutate(deleting);
        }}
      />
    </>
  );
}

function MediaInner() {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  // 搜索防抖：输入先入 q，350ms 后同步进 queryKey 并回到第一页
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
      <PageHeader title="媒体管理" description="全站图片资产：空间占用、归属与清理" />

      {/* toolbar — search (≤320px) + filter chips, per list-page pattern */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文件名 / 用户名…"
            className="pl-8"
          />
        </div>
        <FilterChips
          options={KIND_OPTIONS}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setOffset(0);
          }}
        />
      </div>

      <MediaGrid kind={kind} query={query} offset={offset} onPage={onPage} />
    </div>
  );
}

export default function AdminMediaPage() {
  return <MediaInner />;
}
