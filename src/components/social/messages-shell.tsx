"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InboxList, type InboxTab } from "./inbox-list";

/**
 * Chat-style two-pane inbox（微信/Telegram 范式）:
 * LEFT = 会话列表（私信 tab 为纯发送者会话流 + 未读徽标；通知 tab 为系统
 * 通知）。RIGHT = 选中会话的聊天窗口；未选中时显示空态引导。
 * On mobile only one pane shows at a time: without `selectedUserId` the list
 * is visible; with it, the chat pane.
 */
export function MessagesShell({
  selectedUserId,
  initialTab = "dm",
  children,
}: {
  selectedUserId?: string;
  initialTab?: InboxTab;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] w-full md:h-full">
      <aside
        className={cn(
          "w-full shrink-0 flex-col bg-[var(--muted)]/30 md:flex md:w-72 md:border-r md:border-border xl:w-80",
          selectedUserId ? "hidden" : "flex",
        )}
      >
        <InboxList selectedUserId={selectedUserId} initialTab={initialTab} />
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
