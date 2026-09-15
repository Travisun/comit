"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/primitives";
import { deleteJson, postJson } from "@/lib/client/api";

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
  const [busy, setBusy] = useState(false);
  if (status === "published") return null;

  const deleted = status === "deleted";
  const label = STATUS_LABEL[status] ?? status;

  async function quick(action: "restore" | "purge") {
    if (busy) return;
    if (action === "purge" && !window.confirm("彻底删除？此操作不可恢复。")) return;
    setBusy(true);
    try {
      const message = action === "purge"
        ? await deleteJson(`/api/posts/${postId}?purge=true`)
        : await postJson(`/api/posts/${postId}/restore`, {});
      toast.success(action === "purge" ? "已彻底删除" : "已恢复");
      router.push("/write/posts?tab=trash");
      router.refresh();
      return message;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
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
              onClick={() => void quick("restore")}
              className="font-medium text-primary hover:underline disabled:opacity-50"
            >
              恢复
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void quick("purge")}
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
