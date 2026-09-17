"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { CalendarClock, ListPlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_OPTION_MAX_WEIGHT,
  validatePollOptionsForMode,
  validatePollEndsAt,
  type PollMode,
} from "@/lib/poll";
import { EMOJI_GROUPS } from "./emoji-data";

/**
 * Composer 浮层（Discord/Slack 式 tooltip 面板）：emoji 选择器、话题选择、
 * 投票设置。共用 AnchoredPanel 外壳（定位到触发按钮上方 + 外点关闭 + Esc）。
 */

/* --------------------------- anchored panel shell -------------------------- */

const ANCHOR_PANEL_Z = "z-[60]";

export function AnchoredPanel({
  anchorRef,
  open,
  onClose,
  label,
  width = 320,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  width?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(width, window.innerWidth - 16);
      setStyle({
        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
        bottom: Math.round(window.innerHeight - r.top + 6),
      });
    }
  }, [open, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !style) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{ left: style.left, bottom: style.bottom }}
      className={cn(
        "fixed overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_32px_rgba(42,47,69,0.2)]",
        ANCHOR_PANEL_Z,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------ topic picker ------------------------------- */

interface TopicItem {
  name: string;
  slug: string;
  count: number;
}

/**
 * 话题快捷面板：点击工具栏 # 后弹出 —— 搜索/选择已有话题，或把输入内容
 * 作为自定义话题插入。选中后由 composer 把光标处的 # 补全为「#名称 」。
 */
export function TopicPopover({
  zh,
  anchorRef,
  open,
  onClose,
  onPick,
}: {
  zh: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** name：选中的话题名（不含 #） */
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  // 搜索防抖：输入先入 q，180ms 后同步进 queryKey（驱动 useQuery 重查）
  const [debouncedQ, setDebouncedQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 180);
    return () => clearTimeout(timer);
  }, [q]);

  // 话题搜索 — 防抖值进 queryKey；面板关闭时 enabled 门控不发请求。
  // placeholderData 让切换搜索词时旧结果保留到新结果到达（原手管行为），
  // isPending 仅在首帧（还没有任何结果）时为 true。
  const topicsQ = useQuery({
    // 与 TopicInput 共享同一份缓存
    queryKey: queryKeys.topicsSearch(debouncedQ),
    queryFn: async () => {
      const d = await apiGet<{ items?: TopicItem[] }>(
        `/api/posts/topics?q=${encodeURIComponent(debouncedQ)}`,
      );
      return d.items ?? [];
    },
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const items = topicsQ.data ?? [];
  const loading = topicsQ.isPending;

  const query = q.trim();
  const exact = items.some((t) => t.name.toLowerCase() === query.toLowerCase());
  const custom = query.length > 0 && !exact;

  return (
    <AnchoredPanel anchorRef={anchorRef} open={open} onClose={onClose} label={zh ? "选择话题" : "Topics"} width={300}>
      <div className="border-b border-border p-2">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query) {
              e.preventDefault();
              onPick(query);
            }
          }}
          placeholder={zh ? "搜索话题，或输入新话题…" : "Search or create a topic…"}
          className="h-8 w-full rounded-md bg-[var(--muted)] px-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {zh ? "搜索中…" : "Searching…"}
          </div>
        )}
        {!loading &&
          items.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onPick(t.name)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--hover,#f7f8f8)]"
            >
              <span className="truncate font-medium"># {t.name}</span>
              <span className="num shrink-0 text-xs text-muted-foreground">{t.count} 条</span>
            </button>
          ))}
        {!loading && custom && (
          <button
            type="button"
            onClick={() => onPick(query)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-[var(--hover,#f7f8f8)]"
          >
            <Plus className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {zh ? "使用" : "Use"} “{query}” {zh ? "作为新话题" : "as a new topic"}
            </span>
          </button>
        )}
        {!loading && items.length === 0 && !custom && (
          <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {zh ? "还没有匹配的话题" : "No matching topics"}
          </p>
        )}
      </div>
      <p className="border-t border-border px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
        {zh
          ? "也可直接在正文输入 #话题，发布时自动识别（最多 5 个）"
          : "Or type #topic in the text — up to 5 are detected on publish"}
      </p>
    </AnchoredPanel>
  );
}

/* -------------------------------- poll panel ------------------------------- */

export interface PollDraft {
  mode: PollMode;
  options: string[];
  /** ISO 时间戳 */
  endsAt: string;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 投票设置面板：增删选项（2–5）、单选/多选、结束时间（快捷档 + 自定义）。
 * 「确定」通过校验后提交草稿到 composer；「移除投票」清空。
 */
export function PollPopover({
  zh,
  anchorRef,
  open,
  initial,
  onClose,
  onCommit,
  onRemove,
}: {
  zh: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** 已保存的投票草稿（null = 新建） */
  initial: PollDraft | null;
  onClose: () => void;
  onCommit: (draft: PollDraft) => void;
  onRemove: () => void;
}) {
  // 工作副本由父级以 key 重挂载的方式重置：initial 为空时给一个空草稿，
  // 结束时间留空（快捷档/时间选择器二选一填写）
  const [mode, setMode] = useState<PollMode>(initial?.mode ?? "single");
  const [options, setOptions] = useState<string[]>(
    initial && initial.options.length > 0 ? [...initial.options] : ["", ""],
  );
  const [endsLocal, setEndsLocal] = useState<string>(initial ? toLocalInput(initial.endsAt) : "");

  const trimmed = options.map((o) => o.trim());
  const err =
    validatePollOptionsForMode(mode, trimmed, zh) ??
    (() => {
      const d = new Date(endsLocal);
      return Number.isFinite(d.getTime()) ? validatePollEndsAt(d, zh) : zh ? "结束时间无效" : "Invalid end time";
    })();
  const filled = trimmed.filter(Boolean).length;

  function setOption(i: number, v: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  }

  function addOption() {
    if (options.length >= (mode === "pk" ? 2 : POLL_OPTIONS_MAX)) return;
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(i: number) {
    const floor = mode === "pk" ? 2 : POLL_OPTIONS_MIN;
    setOptions((prev) => (prev.length <= floor ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function preset(days: number) {
    // 仅在点击事件中调用 —— 当前时刻只在交互期读取
    // eslint-disable-next-line react-hooks/purity
    setEndsLocal(toLocalInput(new Date(Date.now() + days * 86_400_000).toISOString()));
  }

  function commit() {
    if (err) {
      toast.error(err);
      return;
    }
    onCommit({
      mode,
      options: trimmed,
      endsAt: new Date(endsLocal).toISOString(),
    });
    onClose();
  }

  return (
    <AnchoredPanel anchorRef={anchorRef} open={open} onClose={onClose} label={zh ? "创建投票" : "Create poll"} width={340}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <ListPlus className="size-4 text-muted-foreground" aria-hidden />
          {zh ? "创建投票" : "Create poll"}
        </span>
        {initial && (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="inline-flex items-center gap-1 text-xs text-destructive transition-colors hover:opacity-80"
          >
            <Trash2 className="size-3" aria-hidden />
            {zh ? "移除投票" : "Remove"}
          </button>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        {/* mode */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">{zh ? "类型" : "Type"}</span>
          <div className="inline-flex rounded-md bg-[var(--muted)] p-[2px]">
            {(["single", "pk", "multiple"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  if (m === "pk") setOptions((prev) => (prev.length > 2 ? prev.slice(0, 2) : prev));
                }}
                className={cn(
                  "h-6 rounded-[5px] px-3 text-xs transition-colors",
                  mode === m
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "single"
                  ? zh
                    ? "单选"
                    : "Single"
                  : m === "pk"
                    ? "PK"
                    : zh
                      ? "多选"
                      : "Multiple"}
              </button>
            ))}
          </div>
        </div>

        {/* options */}
        <div className="space-y-1.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`${zh ? "选项" : "Option"} ${i + 1}`}
                maxLength={80}
                className="h-8 min-w-0 flex-1 rounded-md bg-[var(--muted)] px-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              {options.length > POLL_OPTIONS_MIN && (
                <button
                  type="button"
                  aria-label={zh ? "删除选项" : "Remove option"}
                  onClick={() => removeOption(i)}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addOption}
              disabled={options.length >= POLL_OPTIONS_MAX}
              className="inline-flex items-center gap-1 text-xs text-primary transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden />
              {zh ? "添加选项" : "Add option"}
            </button>
            <span className="num text-[11px] text-muted-foreground">
              {filled}/{POLL_OPTIONS_MIN}-{POLL_OPTIONS_MAX} ·{" "}
              {zh
                ? `每项 ≤${POLL_OPTION_MAX_WEIGHT / 2} 汉字`
                : `${POLL_OPTION_MAX_WEIGHT} chars`}
            </span>
          </div>
        </div>

        {/* end time */}
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden />
            {zh ? "结束时间" : "Ends at"}
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 3, 7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => preset(d)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {d} {zh ? "天" : "d"}
              </button>
            ))}
            <input
              type="datetime-local"
              value={endsLocal}
              onChange={(e) => setEndsLocal(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md bg-[var(--muted)] px-2 text-xs outline-none"
            />
          </div>
        </div>

        {/* commit */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <span className={cn("truncate text-[11px]", err ? "text-destructive" : "text-muted-foreground")}>
            {err ?? (zh ? "发布动态时将附带该投票" : "The poll will be attached to your post")}
          </span>
          <button
            type="button"
            onClick={commit}
            className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {zh ? "确定" : "Done"}
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}

/* ------------------------------- emoji picker ------------------------------ */

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
