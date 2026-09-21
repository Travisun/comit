"use client";

import { useState } from "react";
import { ExternalLink, Check, X, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { deleteJson, postJson, requestJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";

/* ----------------------------- reject dialog ---------------------------- */

export function RejectDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setReason("");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>驳回内容</DialogTitle>
          <DialogDescription>请填写驳回原因，作者将看到这条说明。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason">驳回原因</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：内容包含违规信息，请修改后重新提交"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={() => onSubmit(reason.trim())}
          >
            {pending ? "提交中…" : "确认驳回"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- confirm dialog ---------------------------- */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  destructive = false,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "处理中…" : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- post row actions --------------------------- */

interface PostLike {
  id: string;
  title: string | null;
  status: string;
}

/** Dropdown actions for one post: view / approve / reject / delete. */
export function PostRowActions({ post }: { post: PostLike }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 提交统一走 useApiMutation：pending 驱动禁用态，成功后失效文章列表
  // 缓存（refresh:false — 列表靠 invalidate 回流，不触发整页 RSC 重验）
  const approveMutation = useApiMutation(
    (p: PostLike) => requestJson(`/api/admin/posts/${p.id}/approve`, { method: "POST" }),
    { refresh: false, invalidate: [queryKeys.adminPostsPrefix()], successToast: "已通过审核并发布" },
  );
  const rejectMutation = useApiMutation(
    (input: { post: PostLike; reason: string }) =>
      postJson(`/api/admin/posts/${input.post.id}/reject`, { reason: input.reason }),
    { refresh: false, invalidate: [queryKeys.adminPostsPrefix()], successToast: "已驳回" },
  );
  const deleteMutation = useApiMutation(
    (p: PostLike) => deleteJson(`/api/admin/posts/${p.id}`),
    { refresh: false, invalidate: [queryKeys.adminPostsPrefix()], successToast: "已删除" },
  );
  const pending =
    approveMutation.pending || rejectMutation.pending || deleteMutation.pending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="更多操作">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => window.open(`/p/${post.id}`, "_blank")}>
            <ExternalLink /> 查看
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={post.status === "published"}
            onSelect={() => void approveMutation.mutate(post)}
          >
            <Check /> 通过审核
          </DropdownMenuItem>
          <DropdownMenuItem disabled={post.status === "rejected"} onSelect={() => setRejectOpen(true)}>
            <X /> 驳回…
          </DropdownMenuItem>
          {/* 彻底删除仅对回收站中的文章开放（服务端同款前置：status='deleted'，
              且权限 admin.posts.purge 仅 admin）—— 不在回收站时不显示死按钮 */}
          {post.status === "deleted" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 /> 彻底删除…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        pending={rejectMutation.pending}
        onSubmit={async (reason) => {
          // mutate 失败不抛出（错误 toast 由统一封装兜底），收尾照常关框
          await rejectMutation.mutate({ post, reason });
          setRejectOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除这篇文章？"
        description={`「${post.title ?? "无标题"}」将被永久删除，评论等关联数据一并移除。`}
        confirmText="永久删除"
        destructive
        pending={deleteMutation.pending}
        onConfirm={async () => {
          await deleteMutation.mutate(post);
          setDeleteOpen(false);
        }}
      />
    </>
  );
}
