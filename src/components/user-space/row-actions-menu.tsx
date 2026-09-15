"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  Bookmark,
  UserCheck,
  Flag,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Trash2,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/api";
import { REPORT_REASONS } from "@/components/social/report-dialog";
import type { FeedItemDTO } from "./types";

/**
 * 时间线行右上角「···」快捷菜单（最新/关注流）：
 *   评论 → 详情页评论区     收藏 → 书签 toggle
 *   关注用户 → follow toggle  屏蔽用户 → block toggle
 *   查看详情 → 详情页        举报该内容 → 举报对话框
 * 旧版 guest 不渲染；自己的帖子隐藏 关注/屏蔽/举报。
 */
export function RowActionsMenu({
  post,
  author,
  href,
  mine = false,
}: {
  post: FeedItemDTO["post"];
  author: FeedItemDTO["author"];
  href: string;
  mine?: boolean;
}) {
  const router = useRouter();
  const [bookmarked, setBookmarked] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleBookmark() {
    try {
      const res = await postJson<{ bookmarked: boolean }>("/api/bookmarks", { postId: post.id });
      setBookmarked(res.bookmarked);
      toast.success(res.bookmarked ? "已加入收藏" : "已取消收藏");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function toggleFollow() {
    try {
      const res = await postJson<{ following: boolean }>("/api/follows", { username: author.username });
      setFollowing(res.following);
      toast.success(res.following ? `已关注 @${author.username}` : `已取消关注 @${author.username}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function toggleBlock() {
    try {
      const res = await postJson<{ blocked: boolean }>("/api/blocks", { username: author.username });
      setBlocking(res.blocked);
      toast.success(res.blocked ? `已屏蔽 @${author.username}` : `已取消屏蔽 @${author.username}`);
      if (res.blocked) router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function removePost() {
    if (busy) return;
    if (!window.confirm("将这篇内容移入回收站？可在「我的文章 · 回收站」恢复。")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("已移入回收站");
      router.refresh();
    } catch {
      toast.error("删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    if (!preset || busy) return;
    const extra = detail.trim();
    const text = preset === "其他问题" ? extra : extra ? `${preset} — ${extra}` : preset;
    if (!text) return;
    setBusy(true);
    try {
      await postJson("/api/reports", { targetType: "post", targetId: post.id, reason: text });
      toast.success("已提交举报，管理员会尽快处理");
      setReportOpen(false);
      setPreset(null);
      setDetail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open || mine) return;
          // 打开菜单时拉取真实的关注/屏蔽状态，文案随状态切换
          setFollowing(null);
          setBlocking(null);
          void postJson<{ following: boolean }>(`/api/follows?username=${encodeURIComponent(author.username)}`, {})
            .then((r) => setFollowing(r.following))
            .catch(() => setFollowing(null));
          void postJson<{ blocked: boolean }>(`/api/blocks?username=${encodeURIComponent(author.username)}`, {})
            .then((r) => setBlocking(r.blocked))
            .catch(() => setBlocking(null));
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="更多操作"
            title="更多操作"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-44">
          <MenuItem
            icon={<MessageCircle className="size-4" />}
            label="评论"
            hint={post.commentCount > 0 ? String(post.commentCount) : undefined}
            onClick={() => router.push(`${href}#comments`)}
          />
          <MenuItem
            icon={<Bookmark className={cn("size-4", bookmarked && "fill-current")} />}
            label={bookmarked ? "取消收藏" : "收藏"}
            onClick={() => void toggleBookmark()}
          />
          {!mine && (
            <>
              <MenuItem
                icon={
                  following ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />
                }
                label={`${following ? "取消关注" : "关注"} @${author.username}`}
                onClick={() => void toggleFollow()}
              />
              <MenuItem
                icon={<Ban className="size-4" />}
                label={`${blocking ? "取消屏蔽" : "屏蔽"} @${author.username}`}
                className="text-destructive focus-visible:text-destructive"
                onClick={() => void toggleBlock()}
              />
            </>
          )}
          {mine && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                icon={<PenLine className="size-4" />}
                label="编辑"
                onClick={() => router.push(`/write/${post.id}`)}
              />
              <MenuItem
                icon={<Trash2 className="size-4" />}
                label="删除"
                className="text-destructive focus-visible:text-destructive"
                onClick={() => void removePost()}
              />
            </>
          )}
          <MenuItem
            icon={<ExternalLink className="size-4" />}
            label="查看详情"
            onClick={() => router.push(href)}
          />
          {!mine && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                icon={<Flag className="size-4" />}
                label="举报该内容"
                className="text-destructive focus-visible:text-destructive"
                onClick={() => setReportOpen(true)}
              />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>举报该内容</DialogTitle>
            <DialogDescription>请描述举报原因，管理员会尽快处理。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5" role="radiogroup" aria-label="举报原因">
            {REPORT_REASONS.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                  preset === r
                    ? "border-primary/50 bg-[var(--muted)] text-foreground"
                    : "border-border text-muted-foreground hover:bg-[var(--hover,#f7f8f8)]",
                )}
              >
                <input
                  type="radio"
                  name="row-report-reason"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={preset === r}
                  onChange={() => setPreset(r)}
                />
                {r}
              </label>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="row-report-detail">
              补充说明
              <span className="font-normal text-muted-foreground">
                {preset === "其他问题" ? "（必填，请描述具体问题）" : "（选填）"}
              </span>
            </Label>
            <Textarea
              id="row-report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="补充细节，帮助管理员更快处理…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => void submitReport()}
              disabled={busy || !preset || (preset === "其他问题" && !detail.trim())}
            >
              {busy && <Loader2 className="animate-spin" />}
              提交举报
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  className,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      className={cn("gap-2.5 text-[13px]", className)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {hint && <span className="num text-xs text-muted-foreground">{hint}</span>}
    </DropdownMenuItem>
  );
}
