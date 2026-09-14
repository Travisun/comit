"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InboxList } from "./inbox-list";

/**
 * Two-pane inbox. The LEFT pane is a unified message stream (抽象为"消息"):
 * DM conversations and system notifications merge into one time-sorted
 * list. On mobile only one pane shows at a time: without `selectedUserId`
 * the stream is visible; with it, the chat pane.
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
          "w-full shrink-0 flex-col md:flex md:w-60 md:border-r md:border-border xl:w-64",
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
