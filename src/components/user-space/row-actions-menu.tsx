"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bookmark,
  UserCheck,
  Eye,
  EyeOff,
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
import { apiGet, deleteJson, patchJsonSafe, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { useRscRefresh } from "@/lib/client/rsc-refresh";
import { PostRowMenuSlot } from "@/extensions/_boot/client";
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
  const queryClient = useQueryClient();
  const scheduleRefresh = useRscRefresh();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [detail, setDetail] = useState("");

  // 关注/屏蔽关系 — 语义化 GET 端点，菜单打开时拉取。
  // 加载中按 null 展示默认文案（关注/屏蔽），与原"打开瞬间未知态"一致
  const relationQ = useQuery({
    queryKey: queryKeys.relation(author.username),
    queryFn: async () => {
      const [follow, block] = await Promise.all([
        apiGet<{ following: boolean }>(
          `/api/follows?username=${encodeURIComponent(author.username)}`,
        ),
        apiGet<{ blocked: boolean }>(
          `/api/blocks?username=${encodeURIComponent(author.username)}`,
        ),
      ]);
      return { following: follow.following, blocked: block.blocked };
    },
    enabled: menuOpen && !mine,
  });
  const following = relationQ.data?.following ?? null;
  const blocking = relationQ.data?.blocked ?? null;

  // 收藏状态 — 菜单打开时拉取一次（此前恒显「收藏」，已收藏时文案错误）
  const bookmarkQ = useQuery({
    queryKey: queryKeys.bookmark(post.id),
    queryFn: () =>
      apiGet<{ bookmarked: boolean }>(`/api/bookmarks?postId=${post.id}`).catch(() => ({
        bookmarked: false,
      })),
    enabled: menuOpen,
    staleTime: 30_000,
  });
  const bookmarked = bookmarkQ.data?.bookmarked ?? false;

  const bookmarkMutation = useApiMutation(
    () => postJson<{ bookmarked: boolean }>("/api/bookmarks", { postId: post.id }),
    {
      refresh: false,
      successToast: (res) => (res.bookmarked ? "已加入收藏" : "已取消收藏"),
      onSuccess: (res) => queryClient.setQueryData(queryKeys.bookmark(post.id), res),
    },
  );

  const followMutation = useApiMutation(
    () => postJson<{ following: boolean }>("/api/follows", { username: author.username }),
    {
      refresh: false,
      // 关注状态缓存随 toggle 结果刷新，菜单文案立即翻转
      invalidate: [queryKeys.relation(author.username)],
      successToast: (res) =>
        res.following ? `已关注 @${author.username}` : `已取消关注 @${author.username}`,
    },
  );

  const blockMutation = useApiMutation(
    () => postJson<{ blocked: boolean }>("/api/blocks", { username: author.username }),
    {
      // 原行为等价：仅"屏蔽成功"改变可见范围时回流 RSC
      refresh: false,
      invalidate: [queryKeys.relation(author.username)],
      successToast: (res) =>
        res.blocked ? `已屏蔽 @${author.username}` : `已取消屏蔽 @${author.username}`,
      onSuccess: (res) => {
        if (res.blocked) scheduleRefresh();
      },
    },
  );

  // 删帖 — 失效全部时间线 + 我的管理列表，refresh 保持 true 让 RSC 回流
  const removeMutation = useApiMutation(() => deleteJson(`/api/posts/${post.id}`), {
    invalidate: [queryKeys.feedPrefix(), queryKeys.myPostListPrefix()],
    successToast: "已移入回收站",
  });

  // 作者可见性切换：仅自己可见 ⇄ 公开（PATCH 轻量端点，不触碰 status）
  const visibilityMutation = useApiMutation(
    async () => {
      const r = await patchJsonSafe<{ visibility: string }>(`/api/posts/${post.id}`, {
        visibility: post.visibility === "private" ? "public" : "private",
      });
      if (!r.ok) throw new Error(r.error ?? "操作失败，请稍后再试");
      return r.data;
    },
    {
      refresh: true, // 卡片上的「仅自己可见」徽标与列表归属都要 RSC 回流
      invalidate: [queryKeys.feedPrefix(), queryKeys.myPostListPrefix()],
      successToast: (data) =>
        data?.visibility === "private" ? "已设为仅自己可见" : "已设为公开可见",
    },
  );

  const reportMutation = useApiMutation(
    (reason: string) => postJson("/api/reports", { targetType: "post", targetId: post.id, reason }),
    {
      refresh: false,
      successToast: "已提交举报，管理员会尽快处理",
      onSuccess: () => {
        setReportOpen(false);
        setPreset(null);
        setDetail("");
      },
    },
  );

  function removePost() {
    if (!window.confirm("将这篇内容移入回收站？可在「我的文章 · 回收站」恢复。")) return;
    void removeMutation.mutate(undefined);
  }

  function submitReport() {
    if (!preset || reportMutation.pending) return;
    const extra = detail.trim();
    const text = preset === "其他问题" ? extra : extra ? `${preset} — ${extra}` : preset;
    if (!text) return;
    void reportMutation.mutate(text);
  }

  return (
    <>
      <DropdownMenu onOpenChange={setMenuOpen}>
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
            onClick={() => void bookmarkMutation.mutate(undefined)}
          />
          {!mine && (
            <>
              <MenuItem
                icon={
                  following ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />
                }
                label={`${following ? "取消关注" : "关注"} @${author.username}`}
                onClick={() => void followMutation.mutate(undefined)}
              />
              <MenuItem
                icon={<Ban className="size-4" />}
                label={`${blocking ? "取消屏蔽" : "屏蔽"} @${author.username}`}
                className="text-destructive focus-visible:text-destructive"
                onClick={() => void blockMutation.mutate(undefined)}
              />
            </>
          )}
          {mine && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                icon={
                  post.visibility === "private" ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )
                }
                label={post.visibility === "private" ? "设为公开可见" : "设为仅自己可见"}
                onClick={() => void visibilityMutation.mutate(undefined)}
              />
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
          <PostRowMenuSlot postId={post.id} postType={post.type} publicId={post.publicId} />
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
                    : "border-border text-muted-foreground hover:bg-hover",
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
              disabled={reportMutation.pending || !preset || (preset === "其他问题" && !detail.trim())}
            >
              {reportMutation.pending && <Loader2 className="animate-spin" />}
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
