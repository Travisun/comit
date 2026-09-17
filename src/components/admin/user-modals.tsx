"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { patchJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";

/**
 * Shared user-moderation dialogs (warn / timed ban / permanent ban).
 * They are pure forms: the caller decides where the action goes — the user
 * management API (PATCH /api/admin/users/[id]) or the report workbench
 * (POST /api/admin/reports/[id]/action with action=warn_author/ban_author).
 * Field state is reset on close/submit (event-driven, no effects).
 */

interface UserModerationInput {
  userId: string;
  patch: Record<string, unknown>;
  /** 成功提示文案由动作决定（含目标用户名），成功后由调用方 toast */
  successMessage: string;
}

/**
 * 用户处置提交（解封/角色调整/警告/限时与永久封禁）— 统一走
 * useApiMutation：错误 toast 与原 toastError 文案一致，成功后失效用户
 * 列表缓存；refresh:false，列表数据靠 invalidate 回流。
 */
export function useUserModerationMutation(
  onSuccess?: (input: UserModerationInput) => void,
) {
  // 显式标注泛型：TOutput 为 unknown，避免 onSuccess 形参误导推断
  return useApiMutation<UserModerationInput, unknown>(
    ({ userId, patch }: UserModerationInput) =>
      patchJson(`/api/admin/users/${userId}`, patch),
    { refresh: false, invalidate: [queryKeys.adminUsersPrefix()], onSuccess: (_data, input) => onSuccess?.(input) },
  );
}

export interface ModalityTarget {
  id: string;
  username: string;
  displayName?: string;
}

const BAN_DAYS = [1, 3, 7, 30, 90] as const;

function TargetLine({ target }: { target: ModalityTarget }) {
  return (
    <span className="font-medium text-foreground">
      {target.displayName ?? target.username} (@{target.username})
    </span>
  );
}

/* ------------------------------ warn ------------------------------------ */

export function WarnDialog({
  target,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  target: ModalityTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
  pending: boolean;
}) {
  const [message, setMessage] = useState("");

  const close = () => {
    setMessage("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>警告用户</DialogTitle>
          <DialogDescription>
            {target ? <TargetLine target={target} /> : null} 将收到一条站内警告通知，不影响账号状态。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="warn-message">警告内容</Label>
          <Textarea
            id="warn-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例如：请遵守社区规范，避免发布无关推广内容"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button
            disabled={pending || !message.trim()}
            onClick={() => {
              onSubmit(message.trim());
              setMessage("");
            }}
          >
            {pending ? "发送中…" : "发送警告"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- timed ban ---------------------------------- */

export function TimedBanDialog({
  target,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  target: ModalityTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (days: number, reason: string) => void;
  pending: boolean;
}) {
  const [days, setDays] = useState<number>(7);
  const [reason, setReason] = useState("");

  const close = () => {
    setDays(7);
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>限时封禁</DialogTitle>
          <DialogDescription>
            {target ? <TargetLine target={target} /> : null}
            {" "}将被立即踢下线，封禁期内无法登录；到期后下次登录自动解封。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>封禁时长</Label>
            <div className="flex flex-wrap gap-1.5">
              {BAN_DAYS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={days === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDays(d)}
                >
                  {d} 天
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timed-ban-reason">封禁原因</Label>
            <Textarea
              id="timed-ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="将随封禁通知发送给用户，并记录在审计日志"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={() => {
              onSubmit(days, reason.trim());
              setDays(7);
              setReason("");
            }}
          >
            {pending ? "执行中…" : `确认封禁 ${days} 天`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------- permanent ban -------------------------------- */

export function PermanentBanDialog({
  target,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  target: ModalityTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [confirmWord, setConfirmWord] = useState("");
  const [reason, setReason] = useState("");

  const close = () => {
    setConfirmWord("");
    setReason("");
    onOpenChange(false);
  };

  const confirmed = confirmWord.trim() === "永久";

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="border-destructive/40">
        <DialogHeader>
          <DialogTitle className="text-destructive">永久封禁（不可自动解除）</DialogTitle>
          <DialogDescription>
            {target ? <TargetLine target={target} /> : null}
            {" "}将被立即踢下线且永久无法登录，其内容保留但账号不可恢复使用。此操作仅用于严重违规。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="perm-ban-confirm">
              请输入「<span className="text-destructive">永久</span>」两字以确认
            </Label>
            <Input
              id="perm-ban-confirm"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder="永久"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="perm-ban-reason">封禁原因</Label>
            <Textarea
              id="perm-ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="将随封禁通知发送给用户，并记录在审计日志"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !confirmed || !reason.trim()}
            onClick={() => {
              onSubmit(reason.trim());
              setConfirmWord("");
              setReason("");
            }}
          >
            {pending ? "执行中…" : "永久封禁该账号"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- error toast ------------------------------- */

/** Show the server error of a failed moderation call as a toast. */
export function toastError(err: unknown) {
  toast.error(err instanceof Error ? err.message : "操作失败");
}
