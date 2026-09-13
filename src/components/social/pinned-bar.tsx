"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * PinnedBar — renders children as a floating bar pinned to the bottom of the
 * site panel (see [data-composer-anchor] in site-shell), visible across the
 * whole page scroll. Used by the home composer entry and the comments reply
 * bar (Douyin/Bilibili-style always-within-reach input).
 *
 * A portal is required: sticky only spans its DOM parent, so the bar must be
 * a child of the panel's top-level column — not of a mid-page section — to
 * stay pinned while scrolling through long article bodies. Invisible on the
 * server (portals) and on bare pages without the shell anchor.
 */
export function PinnedBar({ children, className }: { children: ReactNode; className?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setAnchor(document.querySelector<HTMLElement>("[data-composer-anchor]"));
    });
  }, []);

  if (!anchor) return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30",
        "flex justify-center px-4 md:bottom-4 md:px-0",
        className,
      )}
    >
      <div className="pointer-events-auto w-full max-w-[600px]">{children}</div>
    </div>,
    anchor,
  );
}
