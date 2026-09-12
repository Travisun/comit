"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  PenLine,
  Quote,
  Sigma,
  Strikethrough,
  Table,
  Workflow,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn, readingMinutes } from "@/lib/utils";
import { MarkdownEnhance } from "@/components/markdown/markdown-enhance";
import { uploadImage } from "./upload";

/**
 * Markdown editor: textarea + live preview (debounced 400ms via
 * /api/markdown/preview), formatting toolbar, image paste/drag-drop upload and
 * a status bar (word count / reading time / ⌘S hint). `compact` renders the
 * plain textarea variant used by the short-post editor.
 */

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** ⌘S / Ctrl+S handler */
  onSave?: () => void;
  /** short-post mode: no toolbar / preview */
  compact?: boolean;
  className?: string;
}

type TextareaSetter = (next: string, sel?: [number, number]) => void;

type ToolId =
  | "bold"
  | "italic"
  | "strike"
  | "h1"
  | "h2"
  | "link"
  | "image"
  | "quote"
  | "code"
  | "table"
  | "ul"
  | "ol"
  | "task"
  | "math"
  | "mathBlock"
  | "mermaid";

const TOOL_GROUPS: { id: ToolId; title: string; icon: React.ReactNode }[][] = [
  [
    { id: "bold", title: "粗体 Bold", icon: <Bold className="size-4" /> },
    { id: "italic", title: "斜体 Italic", icon: <Italic className="size-4" /> },
    { id: "strike", title: "删除线 Strikethrough", icon: <Strikethrough className="size-4" /> },
  ],
  [
    { id: "h1", title: "一级标题 Heading 1", icon: <Heading1 className="size-4" /> },
    { id: "h2", title: "二级标题 Heading 2", icon: <Heading2 className="size-4" /> },
  ],
  [
    { id: "link", title: "链接 Link", icon: <Link2 className="size-4" /> },
    { id: "image", title: "图片 Image", icon: <ImagePlus className="size-4" /> },
  ],
  [
    { id: "quote", title: "引用 Quote", icon: <Quote className="size-4" /> },
    { id: "code", title: "代码块 Code block", icon: <Code className="size-4" /> },
    { id: "table", title: "表格 Table", icon: <Table className="size-4" /> },
  ],
  [
    { id: "ul", title: "无序列表 Bullet list", icon: <List className="size-4" /> },
    { id: "ol", title: "有序列表 Numbered list", icon: <ListOrdered className="size-4" /> },
    { id: "task", title: "任务列表 Task list", icon: <ListTodo className="size-4" /> },
  ],
  [
    { id: "math", title: "行内公式 Inline math", icon: <Sigma className="size-4" /> },
    { id: "mathBlock", title: "公式块 Math block", icon: <Sigma className="size-4" /> },
    { id: "mermaid", title: "Mermaid 图表 Diagram", icon: <Workflow className="size-4" /> },
  ],
];

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  onSave,
  compact = false,
  className,
}: MarkdownEditorProps) {
  const { t } = useI18n();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const pendingSel = useRef<[number, number] | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [dragging, setDragging] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");

  /* keep "latest" refs in sync after render (read only from handlers/effects) */
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  /* restore selection after programmatic edits */
  useEffect(() => {
    if (!pendingSel.current) return;
    const ta = taRef.current;
    if (!ta) return;
    const [s, e] = pendingSel.current;
    pendingSel.current = null;
    ta.focus();
    try {
      ta.setSelectionRange(s, e);
    } catch {
      /* ignore */
    }
  }, [value]);

  const setValue: TextareaSetter = useCallback((next, sel) => {
    valueRef.current = next;
    if (sel) pendingSel.current = sel;
    onChangeRef.current(next);
  }, []);

  /* ------------------------- editing primitives ------------------------- */

  const insertAtCursor = useCallback(
    (text: string, sel?: [number, number]) => {
      const cur = valueRef.current;
      const ta = taRef.current;
      const s = ta?.selectionStart ?? cur.length;
      const e = ta?.selectionEnd ?? cur.length;
      setValue(cur.slice(0, s) + text + cur.slice(e), sel ?? [s + text.length, s + text.length]);
    },
    [setValue],
  );

  /** symmetric wrap (bold/italic/…), toggles off when already wrapped */
  const wrapInline = useCallback(
    (marker: string, placeholder: string) => {
      const cur = valueRef.current;
      const ta = taRef.current;
      const s = ta?.selectionStart ?? cur.length;
      const e = ta?.selectionEnd ?? cur.length;
      const selected = cur.slice(s, e);
      const before = cur.slice(0, s);
      const after = cur.slice(e);
      if (before.endsWith(marker) && after.startsWith(marker)) {
        setValue(
          before.slice(0, -marker.length) + selected + after.slice(marker.length),
          [s - marker.length, e - marker.length],
        );
        return;
      }
      const body = selected || placeholder;
      setValue(`${before}${marker}${body}${marker}${after}`, [
        s + marker.length,
        s + marker.length + body.length,
      ]);
    },
    [setValue],
  );

  const currentSegment = () => {
    const cur = valueRef.current;
    const ta = taRef.current;
    const s = ta?.selectionStart ?? cur.length;
    const e = ta?.selectionEnd ?? cur.length;
    const start = cur.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const nl = cur.indexOf("\n", e);
    const end = nl === -1 ? cur.length : nl;
    return { start, end, lines: cur.slice(start, end).split("\n") };
  };

  const transformLines = useCallback(
    (transform: (line: string, index: number) => string) => {
      const { start, end, lines } = currentSegment();
      const next = lines.map(transform).join("\n");
      setValue(valueRef.current.slice(0, start) + next + valueRef.current.slice(end), [
        start,
        start + next.length,
      ]);
    },
    [setValue],
  );

  const toggleLinePrefix = useCallback(
    (prefix: string) =>
      transformLines((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line)),
    [transformLines],
  );

  const toggleList = useCallback(
    (kind: "ul" | "ol") => {
      const { lines } = currentSegment();
      const marked =
        kind === "ul"
          ? (l: string) => /^\s*[-*+]\s+/.test(l)
          : (l: string) => /^\s*\d+\.\s+/.test(l);
      const all = lines.every((l) => !l.trim() || marked(l));
      transformLines((line, i) => {
        if (!line.trim()) return line;
        const bare = line.replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1");
        if (all) return bare;
        return kind === "ul" ? `${bare}- ` : `${bare}${i + 1}. `;
      });
    },
    [transformLines],
  );

  /** insert a block snippet; "¤" marks selection/cursor placement */
  const insertBlock = useCallback(
    (snippet: string) => {
      const cur = valueRef.current;
      const ta = taRef.current;
      const s = ta?.selectionStart ?? cur.length;
      const e = ta?.selectionEnd ?? cur.length;
      const before = cur.slice(0, s);
      const selected = cur.slice(s, e);
      const after = cur.slice(e);
      const gap = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const mark = snippet.indexOf("¤");
      const body = mark >= 0 ? snippet.replace("¤", selected) : snippet;
      const base = (before + gap).length;
      setValue(`${before}${gap}${body}\n\n${after}`, [
        base + (mark >= 0 ? mark : body.length),
        base + (mark >= 0 ? mark : body.length),
      ]);
    },
    [setValue],
  );

  const insertLink = useCallback(() => {
    const cur = valueRef.current;
    const ta = taRef.current;
    const s = ta?.selectionStart ?? cur.length;
    const e = ta?.selectionEnd ?? cur.length;
    const text = cur.slice(s, e) || t("editor.title");
    const snippet = `[${text}](https://)`;
    setValue(cur.slice(0, s) + snippet + cur.slice(e), [
      s + text.length + 3,
      s + snippet.length,
    ]);
  }, [setValue, t]);

  /* --------------------------- image uploads ---------------------------- */

  const replaceToken = useCallback(
    (token: string, replacement: string) => {
      const cur = valueRef.current;
      const marker = `(${token})`;
      const idx = cur.indexOf(marker);
      if (idx === -1) return;
      const start = cur.lastIndexOf("![", idx);
      if (start === -1) return;
      const end = idx + marker.length;
      setValue(`${cur.slice(0, start)}${replacement}${cur.slice(end)}`.replace(/\n{3,}/g, "\n\n"));
    },
    [setValue],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      const cur = valueRef.current;
      const ta = taRef.current;
      const s = ta?.selectionStart ?? cur.length;
      const tokens = images.map(
        (_, i) => `up-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      );
      const text = images.map((_, i) => `![${t("editor.uploading")}](${tokens[i]})`).join("\n");
      setValue(cur.slice(0, s) + text + cur.slice(s), [s + text.length, s + text.length]);

      await Promise.all(
        images.map(async (file, i) => {
          try {
            const res = await uploadImage(file, "inline");
            replaceToken(tokens[i], `![${file.name}](${res.url})`);
          } catch (err) {
            toast.error(
              `${t("editor.uploadFail")}${err instanceof Error ? `：${err.message}` : ""}`,
            );
            replaceToken(tokens[i], "");
          }
        }),
      );
    },
    [replaceToken, setValue, t],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const sel = valueRef.current.slice(s, ta.selectionEnd);
      const multiline = sel.includes("\n");
      if (multiline) {
        transformLines(e.shiftKey ? (line) => line.replace(/^ {1,2}/, "") : (line) => `  ${line}`);
      } else if (e.shiftKey) {
        transformLines((line) => line.replace(/^ {1,2}/, ""));
      } else {
        insertAtCursor("  ");
      }
    }
  };

  /* ----------------------------- preview -------------------------------- */

  useEffect(() => {
    if (compact) return;
    const timer = window.setTimeout(() => {
      const content = valueRef.current;
      if (!content.trim()) {
        setPreviewHtml("");
        return;
      }
      fetch("/api/markdown/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
        .then(async (res) => (res.ok ? ((await res.json()) as { html: string }) : null))
        .then((data) => {
          if (data && typeof data.html === "string") setPreviewHtml(data.html);
        })
        .catch(() => {
          /* preview is best-effort */
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [value, compact]);

  /* ------------------------------ toolbar ------------------------------- */

  const runTool = (id: ToolId) => {
    switch (id) {
      case "bold":
        return wrapInline("**", "粗体");
      case "italic":
        return wrapInline("*", "斜体");
      case "strike":
        return wrapInline("~~", "删除线");
      case "h1":
        return toggleLinePrefix("# ");
      case "h2":
        return toggleLinePrefix("## ");
      case "link":
        return insertLink();
      case "image":
        return fileRef.current?.click();
      case "quote":
        return toggleLinePrefix("> ");
      case "code":
        return insertBlock("```\n¤\n```");
      case "table":
        return insertBlock("| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| ¤ |  |  |");
      case "ul":
        return toggleList("ul");
      case "ol":
        return toggleList("ol");
      case "task":
        return toggleLinePrefix("- [ ] ");
      case "math":
        return wrapInline("$", "E=mc^2");
      case "mathBlock":
        return insertBlock("$$\n¤\n$$");
      case "mermaid":
        return insertBlock("```mermaid\n¤flowchart TD\n  A[开始] --> B[结束]\n```");
    }
  };

  const wordCount = value.replace(/\s+/g, "").length;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-none bg-[var(--muted)] focus-within:ring-2 focus-within:ring-[var(--ring)]",
        className,
      )}
    >
      {!compact && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
          {TOOL_GROUPS.map((group, gi) => (
            <div key={`group-${gi}`} className="flex items-center gap-0.5">
              {gi > 0 && <span className="mx-1 h-5 w-px bg-border" />}
              {group.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  title={tool.title}
                  aria-label={tool.title}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runTool(tool.id)}
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {tool.icon}
                </button>
              ))}
            </div>
          ))}
          <span className="flex-1" />
          {/* edit / preview toggle — single pane on every screen size */}
          <div className="flex items-center rounded-lg bg-[var(--muted)] p-0.5">
            <button
              type="button"
              title={t("editor.edit")}
              onClick={() => setView("edit")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === "edit" ? "bg-white text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PenLine className="size-3.5" />
              {t("editor.edit")}
            </button>
            <button
              type="button"
              title={t("editor.preview")}
              onClick={() => setView("preview")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === "preview" ? "bg-white text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="size-3.5" />
              {t("editor.preview")}
            </button>
          </div>
        </div>
      )}

      {/* single pane — edit or preview; writing column centered with a
          comfortable max-width inside the full-size container */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
          {view === "edit" ? (
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.items)
                  .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
                  .map((it) => it.getAsFile())
                  .filter((f): f is File => Boolean(f));
                if (files.length) {
                  e.preventDefault();
                  void uploadFiles(files);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void uploadFiles(Array.from(e.dataTransfer.files));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              placeholder={placeholder}
              spellCheck={false}
              className={cn(
                "min-h-[55vh] w-full flex-1 resize-none bg-transparent px-6 py-5 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground",
                dragging && "ring-2 ring-inset ring-[var(--ring)]",
              )}
            />
          ) : (
            <div className="min-h-[55vh] flex-1 px-6 py-5">
              {previewHtml.trim() ? (
                <>
                  <div
                    className="article-prose"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                  <MarkdownEnhance scanKey={previewHtml} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("editor.preview")}…</p>
              )}
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {t("editor.wordCount")} {wordCount} · {t("editor.readingTime")} {readingMinutes(value)}
          </span>
          <span className="truncate">{t("editor.keyboardHint")}</span>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
