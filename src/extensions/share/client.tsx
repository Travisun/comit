"use client";

import { Link2 } from "lucide-react";
import { appToast } from "@/lib/client/toast";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { registerUiPlugin } from "@/lib/plugins/ui";
import type { ExtensionManifest } from "@/core/capabilities/manifest";
import manifest from "./manifest";

/**
 * 复制链接扩展 · 客户端：向帖子详情快捷操作栏与时间线行「···」菜单注入
 * 「复制链接」。无服务端 — 证明纯前端扩展的最小形态。
 */

function shareUrl(ctx: { postId: string; postType: "article" | "short"; slug: string | null }) {
  const path =
    ctx.postType === "article" ? `/post/${ctx.slug ?? ctx.postId}` : `/p/${ctx.postId}`;
  return `${window.location.origin}${path}`;
}

async function copyLink(ctx: { postId: string; postType: "article" | "short"; slug: string | null }) {
  try {
    await navigator.clipboard.writeText(shareUrl(ctx));
    appToast.success("链接已复制 / Link copied");
  } catch {
    appToast.error("复制失败 / Copy failed");
  }
}

function ShareAction(ctx: { postId: string; postType: "article" | "short"; slug: string | null }) {
  return (
    <button
      type="button"
      onClick={() => void copyLink(ctx)}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-[var(--hover,#f7f8f8)] hover:text-foreground"
      title="复制链接"
    >
      <Link2 className="size-4 shrink-0" />
      <span className="hidden sm:inline">复制链接</span>
    </button>
  );
}

function ShareMenuItem(ctx: { postId: string; postType: "article" | "short"; slug: string | null }) {
  return (
    <DropdownMenuItem onSelect={() => void copyLink(ctx)}>
      <Link2 /> 复制链接
    </DropdownMenuItem>
  );
}

registerUiPlugin({
  name: manifest.id,
  version: manifest.version,
  registrations: [
    { slot: "post:actions", component: ShareAction },
    { slot: "post:row-menu", component: ShareMenuItem },
  ],
});
