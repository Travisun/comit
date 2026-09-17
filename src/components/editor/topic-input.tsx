"use client";

import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Topic chips input (≤ max). Enter / comma commits a chip; suggestions come
 * from GET /api/posts/topics?q= (most-used first) with 250ms debounce.
 */
export function TopicInput({
  value,
  onChange,
  max = 5,
  dropUp = false,
}: {
  value: string[];
  onChange: (topics: string[]) => void;
  max?: number;
  /** open the suggestion panel above the field (for toolbars at a sheet bottom) */
  dropUp?: boolean;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 联想防抖：输入先入 input，250ms 后把去空格的词同步进 queryKey（驱动重查）
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  // 话题联想 — 防抖值进 queryKey；空词 enabled 门控不发请求（下拉随之隐藏）。
  // placeholderData 让继续输入时旧联想保留到新结果到达（原手管行为）。
  const suggestionsQ = useQuery({
    // 与 TopicPopover 共享同一份缓存
    queryKey: queryKeys.topicsSearch(debouncedQ),
    queryFn: async () => {
      const data = await apiGet<{ items?: { name: string; count: number }[] }>(
        `/api/posts/topics?q=${encodeURIComponent(debouncedQ)}`,
      );
      return data.items ?? [];
    },
    enabled: debouncedQ.length > 0,
    placeholderData: keepPreviousData,
  });
  // 空词显式清空（placeholderData 会保留上一关键词的数据，需在此拦下）
  const suggestions = debouncedQ.length > 0 ? (suggestionsQ.data ?? []) : [];

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
              // claim the key so the host sheet/dialog doesn't also close
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {open && !full && suggestions.length > 0 && (
        <div
          className={cn(
            "absolute z-30 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg",
            dropUp ? "bottom-full mb-1" : "mt-1",
          )}
        >
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
