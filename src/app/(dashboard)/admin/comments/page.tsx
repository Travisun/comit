"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
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
import { routes } from "@/core/routes";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { deleteJson, patchJson } from "@/lib/client/api";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

// 就地 zod schema：/api/admin/comments 响应无现成 schema，进缓存前校验把关
const commentItemSchema = z.object({
  id: z.string(),
  body: z.string(),
  status: z.string(),
  postId: z.string(),
  postPublicId: z.string(),
  postTitle: z.string().nullable(),
  createdAt: z.string(),
  author: z.object({ username: z.string(), displayName: z.string() }),
});

const commentsListSchema = z.object({
  items: z.array(commentItemSchema),
  total: z.number(),
});

type CommentItem = z.infer<typeof commentItemSchema>;

const PAGE_SIZE = 25;

/** Fetches and renders one page of comments; keyed by page via queryKey. */
function CommentList({
  offset,
  onPage,
}: {
  offset: number;
  onPage: (next: number) => void;
}) {
  const { locale } = useI18n();
  // 列表查询 — key 随分页变化天然隔离（原 remount-by-key 防竞态 hack 已删）；
  // placeholderData 让翻页时保留上一页数据不闪空
  const commentsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminComments(offset),
      url: `/api/admin/comments?limit=${PAGE_SIZE}&offset=${offset}`,
      schema: commentsListSchema,
      placeholderData: keepPreviousData,
    }),
  );
  const items = useMemo(() => commentsQ.data?.items ?? [], [commentsQ.data]);
  const total = commentsQ.data?.total ?? 0;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentItem | null>(null);

  // 隐藏/恢复 — 成功后失效评论列表（refresh:false，当页列表 invalidate 即可）
  const statusMutation = useApiMutation(
    (input: { comment: CommentItem; status: "visible" | "hidden"; success: string }) =>
      patchJson(`/api/admin/comments/${input.comment.id}`, { status: input.status }),
    {
      refresh: false,
      invalidate: [queryKeys.adminCommentsPrefix()],
      // 成功提示随动作而变（恢复显示 / 隐藏），在 onSuccess 里 toast
      onSuccess: (_data, input) => toast.success(input.success),
    },
  );
  const deleteMutation = useApiMutation(
    (comment: CommentItem) => deleteJson(`/api/admin/comments/${comment.id}`),
    {
      refresh: false,
      invalidate: [queryKeys.adminCommentsPrefix()],
      successToast: "评论已删除",
      onSuccess: () => setDeleteTarget(null),
    },
  );

  async function applyStatus(
    comment: CommentItem,
    status: "visible" | "hidden",
    success: string,
  ) {
    // pendingId 记录行内操作归属（mutation.pending 是全局的，禁用态按行判定）
    setPendingId(comment.id);
    // mutate 失败不抛出（错误 toast 文案与原实现一致）
    await statusMutation.mutate({ comment, status, success });
    setPendingId(null);
  }

  async function remove(comment: CommentItem) {
    setPendingId(comment.id);
    await deleteMutation.mutate(comment);
    setPendingId(null);
  }

  if (commentsQ.error) return <EmptyState title="加载失败" hint={commentsQ.error.message} />;
  if (commentsQ.isPending) return <TableSkeleton rows={8} cols={5} />;
  if (items.length === 0) return <EmptyState title="还没有评论" />;

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
          {items.map((c) => {
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
                    href={routes.post(c.postPublicId)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-foreground hover:underline"
                  >
                    {c.postTitle ?? "（动态）"}
                  </a>
                </td>
                <td>
                  <CommentStatusBadge status={c.status} />
                </td>
                <td className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums">
                  {timeAgo(c.createdAt, locale)}
                </td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    {c.status === "hidden" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actDisabled}
                        onClick={() => void applyStatus(c, "visible", "评论已恢复显示")}
                      >
                        <Eye className="size-3.5" />
                        恢复
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actDisabled}
                        onClick={() => void applyStatus(c, "hidden", "评论已隐藏")}
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
      <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPage={onPage} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        title="删除这条评论？"
        description={deleteTarget ? `「${deleteTarget.body.slice(0, 60)}…」将不再对外显示。` : undefined}
        confirmText="确认删除"
        destructive
        pending={deleteMutation.pending}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget);
        }}
      />
    </>
  );
}

export default function AdminCommentsPage() {
  const [offset, setOffset] = useState(0);

  const onPage = (next: number) => setOffset(next);

  return (
    <div>
      <PageHeader title="评论管理" description="隐藏、恢复或删除全站评论" />
      <CommentList offset={offset} onPage={onPage} />
    </div>
  );
}
