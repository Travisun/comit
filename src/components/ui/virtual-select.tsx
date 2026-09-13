"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Virtual select — a styled trigger button + dropdown panel (no native
 * <select>). Keyboard / click to open, click option to select, close on
 * outside click. Supports a leading icon slot.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export function VirtualSelect({
  value,
  options,
  onChange,
  placeholder,
  icon,
  className,
  panelClassName,
  disabled = false,
  dropUp = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  panelClassName?: string;
  disabled?: boolean;
  /** open the panel above the trigger (for toolbars pinned to a sheet bottom) */
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // claim the key so the host sheet/dialog doesn't also close
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center gap-1.5 rounded-md border-0 bg-card px-2.5 text-sm",
          "shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)]",
          "outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)]",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {icon}
        <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? "请选择"}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute z-40 w-full min-w-fit overflow-hidden rounded-lg border border-border bg-popover shadow-lg",
            dropUp ? "bottom-full mb-1" : "mt-1",
            panelClassName,
          )}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                o.value === value
                  ? "bg-[var(--selected)] font-medium text-foreground"
                  : "text-[color:var(--text-body)] hover:bg-[var(--hover)]",
              )}
            >
              {o.label}
              {o.value === value && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
