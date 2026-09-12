"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  CommentStatusBadge,
  PageHeader,
  Pagination,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { ConfirmDialog } from "@/components/admin/post-actions";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface CommentItem {
  id: string;
  body: string;
  status: string;
  postId: string;
  postTitle: string | null;
  createdAt: string;
  author: { username: string; displayName: string };
}

const PAGE_SIZE = 25;

/** Fetches and renders one page of comments; remounted (via key) on page change. */
function CommentList({
  offset,
  onPage,
  onChanged,
}: {
  offset: number;
  onPage: (next: number) => void;
  onChanged: () => void;
}) {
  const { locale } = useI18n();
  const [data, setData] = useState<{ items: CommentItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: CommentItem[]; total: number }>(
      `/api/admin/comments?limit=${PAGE_SIZE}&offset=${offset}`,
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, onChanged]);

  async function setStatus(comment: CommentItem, status: "visible" | "hidden", success: string) {
    setPendingId(comment.id);
    try {
      await api(`/api/admin/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      toast.success(success);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(comment: CommentItem) {
    setPendingId(comment.id);
    try {
      await api(`/api/admin/comments/${comment.id}`, { method: "DELETE" });
      toast.success("评论已删除");
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPendingId(null);
    }
  }

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={8} cols={5} />;
  if (data.items.length === 0) return <EmptyState title="还没有评论" />;

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <th>内容</th>
            <th>作者</th>
            <th>所属文章</th>
            <th>状态</th>
            <th className="text-right">时间</th>
            <th className="w-44" />
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => {
            const actDisabled = pendingId === c.id || c.status === "deleted";
            return (
              <tr key={c.id}>
                <td className="max-w-80">
                  <span className="block truncate" title={c.body}>
                    {c.body}
                  </span>
                </td>
                <td className="whitespace-nowrap text-muted-foreground">@{c.author.username}</td>
                <td className="max-w-44">
                  <a
                    href={`/p/${c.postId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate hover:underline"
                  >
                    {c.postTitle ?? "（动态）"}
                  </a>
                </td>
                <td>
                  <CommentStatusBadge status={c.status} />
                </td>
                <td className="whitespace-nowrap text-right text-xs text-muted-foreground">
                  {timeAgo(c.createdAt, locale)}
                </td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    {c.status === "hidden" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actDisabled}
                        onClick={() => setStatus(c, "visible", "评论已恢复显示")}
                      >
                        <Eye className="size-3.5" />
                        恢复
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actDisabled}
                        onClick={() => setStatus(c, "hidden", "评论已隐藏")}
                      >
                        <EyeOff className="size-3.5" />
                        隐藏
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      disabled={actDisabled}
                      aria-label="删除评论"
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPage={onPage} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        title="删除这条评论？"
        description={deleteTarget ? `「${deleteTarget.body.slice(0, 60)}…」将不再对外显示。` : undefined}
        confirmText="确认删除"
        destructive
        pending={false}
        onConfirm={() => {
          if (deleteTarget) remove(deleteTarget);
        }}
      />
    </>
  );
}

export default function AdminCommentsPage() {
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const onPage = useCallback((next: number) => setOffset(next), []);

  return (
    <div>
      <PageHeader title="评论管理" description="隐藏、恢复或删除全站评论" />
      <CommentList
        key={`${offset}|${version}`}
        offset={offset}
        onPage={onPage}
        onChanged={bump}
      />
    </div>
  );
}
