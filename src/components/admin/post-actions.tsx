"use client";

import { useState } from "react";
import { ExternalLink, Check, X, Trash2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
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
import { api } from "./client";

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

export interface PostLike {
  id: string;
  title: string | null;
  status: string;
}

/** Dropdown actions for one post: view / approve / reject / delete. */
export function PostRowActions({ post, onChanged }: { post: PostLike; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await fn();
      toast.success(success);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  const approve = () =>
    run(() => api(`/api/admin/posts/${post.id}/approve`, { method: "POST" }), "已通过审核并发布");
  const reject = (reason: string) =>
    run(
      () =>
        api(`/api/admin/posts/${post.id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      "已驳回",
    ).then(() => setRejectOpen(false));
  const remove = () =>
    run(() => api(`/api/admin/posts/${post.id}`, { method: "DELETE" }), "已删除").then(() =>
      setDeleteOpen(false),
    );

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
            onSelect={() => approve()}
          >
            <Check /> 通过审核
          </DropdownMenuItem>
          <DropdownMenuItem disabled={post.status === "rejected"} onSelect={() => setRejectOpen(true)}>
            <X /> 驳回…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 /> 删除…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        pending={pending}
        onSubmit={reject}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除这篇文章？"
        description={`「${post.title ?? "无标题"}」将被永久删除，评论等关联数据一并移除。`}
        confirmText="永久删除"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </>
  );
}
