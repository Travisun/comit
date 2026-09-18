"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InboxList } from "./inbox-list";

/**
 * Chat-style two-pane inbox（微信/Telegram 范式）:
 * LEFT = 会话列表 — 置顶 System 官方会话（系统通知抽象为私信）+ DM 会话，
 * 均带未读徽标与最后一条消息预览。RIGHT = 选中会话的聊天窗口
 * （/messages/[userId] 或 /messages/system）；未选中时显示空态引导。
 * On mobile only one pane shows at a time: without `selectedUserId` the list
 * is visible; with it, the chat pane.
 */
export function MessagesShell({
  selectedUserId,
  children,
}: {
  selectedUserId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] w-full md:h-full">
      <aside
        className={cn(
          "w-full shrink-0 flex-col bg-[var(--muted)]/30 md:flex md:w-64 md:border-r md:border-border xl:w-72",
          selectedUserId ? "hidden" : "flex",
        )}
      >
        <InboxList selectedUserId={selectedUserId} />
      </aside>
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-card",
          selectedUserId ? "flex" : "hidden md:flex",
        )}
      >
        {children}
      </section>
    </div>
  );
}
