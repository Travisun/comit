"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/primitives";

/**
 * Topic chips input (≤ max). Enter / comma commits a chip; suggestions come
 * from GET /api/posts/topics?q= (most-used first) with 250ms debounce.
 */
export function TopicInput({
  value,
  onChange,
  max = 5,
}: {
  value: string[];
  onChange: (topics: string[]) => void;
  max?: number;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; count: number }[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = input.trim();
      if (!q) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/posts/topics?q=${encodeURIComponent(q)}`)
        .then(async (res) => (res.ok ? ((await res.json()) as { items: { name: string; count: number }[] }) : null))
        .then((data) => setSuggestions(data?.items ?? []))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const commit = (raw: string) => {
    const name = raw.trim().replace(/[,，]/g, "").replace(/\s+/g, " ").slice(0, 60);
    setInput("");
    if (!name) return;
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    if (value.length >= max) return;
    onChange([...value, name]);
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));
  const full = value.length >= max;

  return (
    <div ref={boxRef} className="relative">
      <div
        className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name) => (
          <Badge key={name} variant="secondary" className="gap-1 pr-1">
            {name}
            <button
              type="button"
              aria-label={`${t("post.delete")}: ${name}`}
              onClick={() => remove(name)}
              className="rounded-full p-0.5 hover:bg-foreground/10"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          value={input}
          disabled={full}
          placeholder={full ? `${t("editor.topics")}（≤${max}）` : t("editor.topicsHint")}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",") || v.includes("，")) {
              v.split(/[,，]/).forEach((part) => commit(part));
            } else {
              setInput(v);
              setOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(input);
              setOpen(false);
            } else if (e.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {open && !full && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover">
          {suggestions.slice(0, 8).map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => {
                commit(s.name);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span>{s.name}</span>
              {s.count > 0 && <span className="text-xs text-muted-foreground">{s.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
