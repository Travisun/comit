"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Repeat2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApiError, postJson } from "@/lib/client/api";
import { openLoginDialog } from "@/lib/store/login-dialog";
import { appToast } from "@/lib/client/toast";

/**
 * 转发（quote-forward）— 点击后在原文留一条评论，并发布一条引用原动态：
 * 内容 = 用户评论 + 「转发自《标题》+ 地址」引用块；转发计数照常 +1，
 * 原文作者经评论通知与 post:reposted 事件收到通知。
 *
 * 状态修复：转发是否成功以服务端响应为准（旧的乐观翻转让按钮在请求发出
 * 前就显示「已转发」，请求失败时状态与事实脱节）。
 */
export function RepostButton({
  postId,
  publicId,
  originalTitle,
  initialCount,
  initialReposted,
  signedIn = true,
  className,
  fixedLabel = false,
}: {
  postId: string;
  /** 原文 permalink（/post/{publicId}），引用块链接用 */
  publicId: string;
  /** 原文标题（短动态为摘要截断），引用块文案用 */
  originalTitle: string;
  initialCount: number;
  initialReposted: boolean;
  /** 游客点击直接唤起登录 dialog */
  signedIn?: boolean;
  className?: string;
  /** 详情操作栏模式：恒显「转发」两字（计数入 title），保证各操作宽度一致 */
  fixedLabel?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reposted, setReposted] = useState(initialReposted);
  const [count, setCount] = useState(initialCount);

  const quoteText = comment.trim();

  function onClick() {
    if (!signedIn) {
      openLoginDialog();
      return;
    }
    if (reposted) {
      // 转发不可撤销：再次点击仅提示（引用动态已发布，无法收回）
      appToast.info(t("post.forwardIrreversible"));
      return;
    }
    setOpen(true);
  }

  /** 转发三步：引用动态 → 原文评论 → 转发记录（计数） */
  async function submitForward() {
    if (!quoteText || submitting) return;
    setSubmitting(true);
    try {
      const url = `${window.location.origin}/post/${publicId}`;
      // 超链接形式（与主页动态渲染一致）：转发自《标题》（点击跳原文），
      // 不再使用引用块 + 裸地址的生硬排版
      const quote = `${t("post.forwardFrom")} [《${originalTitle}》](${url})`;
      await postJson("/api/posts", {
        type: "short",
        content: `${quoteText}\n\n${quote}`,
        action: "submit",
      });
      await postJson("/api/comments", { postId, body: quoteText });
      const r = await postJson<{ reposted: boolean; count: number }>("/api/reposts", {
        postId,
        comment: quoteText,
      });
      setReposted(r.reposted);
      setCount(r.count);
      setOpen(false);
      setComment("");
      appToast.success(t("post.forwardDone"));
      // 引用动态进入时间线 / 原文计数变化 → 让 RSC 回流
      router.refresh();
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (err) {
      appToast.error(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        aria-pressed={reposted}
        title={reposted ? t("post.reposted") : t("post.repost")}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm transition-colors",
          "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-500",
          "disabled:pointer-events-none disabled:opacity-60",
          reposted && "text-emerald-600 hover:text-emerald-600",
          className,
        )}
      >
        <Repeat2 className="size-4 shrink-0" />
        {fixedLabel ? (
          <span>{t("post.repost")}</span>
        ) : count > 0 ? (
          <span className="tabular-nums">{count}</span>
        ) : (
          <span className="hidden sm:inline">{t("post.repost")}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("post.repost")}</DialogTitle>
            <DialogDescription>{t("post.forwardHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder={t("post.forwardPlaceholder")}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={() => void submitForward()} disabled={submitting || !quoteText}>
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("post.repost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
