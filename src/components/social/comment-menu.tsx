"use client";

import { BadgeCheck, Eye, EyeOff, MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { deleteJsonSafe, patchJsonSafe } from "@/lib/client/api";

/**
 * 评论右上角「···」操作菜单（评论区行内 / 个人主页动态评论行共用）：
 *   帖子作者：置顶（单槽）/ 标记解决方案
 *   评论作者：仅自己可见 ⇄ 公开可见
 *   有删除权者（评论作者/帖子作者/被回复者）：删除
 * 操作成功后回调 onChanged（调用方负责刷新各自的数据视图）。
 */

export interface CommentMenuData {
  id: string;
  pinned?: boolean;
  solution?: boolean;
  /** public | private */
  visibility?: string;
  /** 当前观众是否评论作者（可见性切换仅本人可用） */
  mine?: boolean;
  canDelete?: boolean;
  /** 帖子作者（置顶/解决方案管理权） */
  canManage?: boolean;
  /** 内部流转标记：删除成功后回传 */
  deleted?: boolean;
}

export function CommentMenu({
  comment,
  onChanged,
  onManage,
  onRemove,
  className,
}: {
  comment: CommentMenuData;
  /** 可见性切换成功后的回调（默认无操作） */
  onChanged?: (c: CommentMenuData) => void;
  /** 置顶/解决方案走调用方既有 manage 流（评论区带 toast+失效）；缺省走内置 PATCH */
  onManage?: (id: string, action: "pin" | "unpin" | "solve" | "unsolve") => void;
  /** 删除走调用方既有 remove 流（带确认+缓存清理）；缺省走内置 confirm+DELETE */
  onRemove?: (id: string) => void;
  className?: string;
}) {
  const hasManage = Boolean(comment.canManage);
  const hasVisibility = Boolean(comment.mine);
  const hasDelete = Boolean(comment.canDelete);
  if (!hasManage && !hasVisibility && !hasDelete) return null;

  async function toggleVisibility() {
    const next = comment.visibility === "private" ? "public" : "private";
    const r = await patchJsonSafe("/api/comments", { id: comment.id, action: next });
    if (!r.ok) {
      toast.error(r.error ?? "操作失败，请稍后再试");
      return;
    }
    toast.success(next === "private" ? "已设为仅自己可见" : "已设为公开可见");
    onChanged?.({ ...comment, visibility: next });
  }

  async function remove() {
    if (!window.confirm("确定删除这条评论？")) return;
    const r = await deleteJsonSafe(`/api/comments?id=${encodeURIComponent(comment.id)}`);
    if (!r.ok) {
      toast.error(r.error ?? "删除失败，请稍后再试");
      return;
    }
    onChanged?.({ ...comment, deleted: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="评论操作"
          title="评论操作"
          className={cn(
            "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-44">
        {hasManage && (
          <>
            <DropdownMenuItem
              className="gap-2.5 text-[13px]"
              onClick={(e) => {
                e.stopPropagation();
                if (onManage) onManage(comment.id, comment.pinned ? "unpin" : "pin");
              }}
            >
              <Pin className="size-4" />
              <span className="flex-1">{comment.pinned ? "取消置顶" : "置顶"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5 text-[13px]"
              onClick={(e) => {
                e.stopPropagation();
                if (onManage) onManage(comment.id, comment.solution ? "unsolve" : "solve");
              }}
            >
              <BadgeCheck className="size-4" />
              <span className="flex-1">{comment.solution ? "取消解决方案" : "标记为解决方案"}</span>
            </DropdownMenuItem>
          </>
        )}
        {hasVisibility && (
          <>
            {(hasManage || hasDelete) && <DropdownMenuSeparator />}
            <DropdownMenuItem
              className="gap-2.5 text-[13px]"
              onClick={(e) => {
                e.stopPropagation();
                void toggleVisibility();
              }}
            >
              {comment.visibility === "private" ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
              <span className="flex-1">
                {comment.visibility === "private" ? "设为公开可见" : "设为仅自己可见"}
              </span>
            </DropdownMenuItem>
          </>
        )}
        {hasDelete && (
          <>
            {(hasManage || hasVisibility) && <DropdownMenuSeparator />}
            <DropdownMenuItem
              className="gap-2.5 text-[13px] text-destructive focus-visible:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                if (onRemove) onRemove(comment.id);
                else void remove();
              }}
            >
              <Trash2 className="size-4" />
              <span className="flex-1">删除</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
