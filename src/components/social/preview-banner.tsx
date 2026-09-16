"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/primitives";
import { deleteJson, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "审核中",
  rejected: "被驳回",
  deleted: "回收站",
};

/**
 * Author preview banner for non-published posts (draft / pending review /
 * rejected / recycle bin). Renders the state label plus context-appropriate
 * quick actions: continue editing, or restore / purge from the recycle bin.
 */
export function PreviewBanner({
  postId,
  status,
  rejectReason,
  className,
}: {
  postId: string;
  status: string;
  rejectReason?: string | null;
  className?: string;
}) {
  const router = useRouter();
  // 恢复 / 彻底删除（回收站两个快捷动作共用一个 mutation，busy 即 pending）
  const quickMutation = useApiMutation(
    (action: "restore" | "purge") =>
      action === "purge"
        ? deleteJson(`/api/posts/${postId}?purge=true`)
        : postJson(`/api/posts/${postId}/restore`, {}),
    {
      // refresh 关闭：跳转与刷新必须在同一 transition 内派发（见下），不用
      // 统一重验通道以免与 push 的 RSC 流交叠
      refresh: false,
      silent: true,
      onError: (err) => toast.error(err instanceof Error && err.message ? err.message : "操作失败"),
      onSuccess: (_message, action) => {
        toast.success(action === "purge" ? "已彻底删除" : "已恢复");
        // 同一 transition 内派发：push 与 refresh 的两次 RSC 更新由 React 合并应用，
        // 避免两个飞行中的 RSC 流交叠触发 flight 客户端竞态（enqueueModel 崩溃）
        startTransition(() => {
          router.push("/write/posts?tab=trash");
          router.refresh();
        });
      },
    },
  );
  const busy = quickMutation.pending;
  if (status === "published") return null;

  const deleted = status === "deleted";
  const label = STATUS_LABEL[status] ?? status;

  function quick(action: "restore" | "purge") {
    if (busy) return;
    if (action === "purge" && !window.confirm("彻底删除？此操作不可恢复。")) return;
    void quickMutation.mutate(action);
  }

  return (
    <div
      className={
        "flex flex-wrap items-center gap-2 border-b border-border bg-[var(--muted)] px-4 py-2 text-xs text-muted-foreground " +
        (className ?? "")
      }
    >
      <Badge variant={status === "rejected" ? "destructive" : "warning"}>{label}</Badge>
      {status === "rejected" && rejectReason && (
        <span className="truncate text-destructive">驳回原因:{rejectReason}</span>
      )}
      <span>
        {deleted ? "此内容在回收站中，仅自己可见" : "此内容尚未发布，仅自己可见"}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {deleted ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => quick("restore")}
              className="font-medium text-primary hover:underline disabled:opacity-50"
            >
              恢复
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => quick("purge")}
              className="font-medium text-destructive hover:underline disabled:opacity-50"
            >
              彻底删除
            </button>
          </>
        ) : (
          <Link
            href={`/write/${postId}`}
            className="font-medium text-primary hover:underline"
          >
            继续编辑 →
          </Link>
        )}
      </span>
    </div>
  );
}
