"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EMOJI_GROUPS } from "./emoji-data";

/**
 * Emoji picker — a floating tooltip panel anchored to its trigger button
 * (Discord/Slack style). Self-contained curated unicode set: zero
 * dependencies, instant open. Unicode characters carry no licensing
 * restrictions.
 */

export function EmojiPopover({
  label,
  onPick,
  children,
}: {
  label: string;
  onPick: (emoji: string) => void;
  /** trigger content (icon) */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(EMOJI_GROUPS[0].key);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        bottom: Math.round(window.innerHeight - r.top + 6),
      });
    }
    setOpen((o) => !o);
  }

  const group = EMOJI_GROUPS.find((g) => g.key === active) ?? EMOJI_GROUPS[0];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={toggle}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
          open
            ? "bg-[var(--selected)] text-foreground"
            : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground",
        )}
      >
        {children}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{ left: pos?.left ?? 0, bottom: pos?.bottom ?? 0 }}
            className="fixed z-[60] w-[min(360px,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_32px_rgba(42,47,69,0.2)]"
          >
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border p-1.5 scrollbar-none">
              {EMOJI_GROUPS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  title={g.label}
                  aria-label={g.label}
                  aria-pressed={g.key === active}
                  onClick={() => setActive(g.key)}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg text-base transition-colors",
                    g.key === active ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]",
                  )}
                >
                  {g.icon}
                </button>
              ))}
              <span className="ml-auto shrink-0 pr-1.5 text-xs text-muted-foreground">{group.label}</span>
            </div>
            <div className="grid max-h-56 grid-cols-10 gap-0.5 overflow-y-auto p-2 max-md:grid-cols-8">
              {group.emojis.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  type="button"
                  onClick={() => onPick(e)}
                  className="grid size-8 place-items-center rounded-lg text-lg leading-none transition-transform hover:scale-125 hover:bg-[var(--hover)]"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Insert text at the caret of a controlled textarea and restore focus. */
export function insertAtCursor(
  el: HTMLTextAreaElement | null,
  text: string,
  value: string,
  onChange: (next: string) => void,
) {
  if (!el) {
    onChange(value + text);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = start + text.length;
  });
}
