"use client";

import { useEffect, useRef } from "react";
import Vditor from "vditor";
import "vditor/dist/index.css";
import { cn } from "@/lib/utils";

/**
 * Vditor wrapper — visual markdown editor with real-time rendering (IR mode
 * by default, switchable to WYSIWYG / split preview from the toolbar).
 * Assets are self-hosted from /public/vditor (copied from node_modules).
 *
 * - `value` is the markdown source; parent owns the state (onChange fires on
 *   Vditor's input debounce).
 * - ⌘S / Ctrl+S is forwarded to `onSave` instead of triggering Vditor save.
 */

export interface VditorEditorProps {
  value: string;
  onChange: (md: string) => void;
  onSave?: () => void;
  placeholder?: string;
  className?: string;
  /** "slim" trims the toolbar for compact surfaces (e.g. the composer sheet). */
  toolbar?: "full" | "slim";
  /**
   * Explicit height for the editor surface, e.g. "100%" to fill a flex pane
   * (forwarded to Vditor's own `height` option; default "auto").
   */
  height?: string;
}

const TOOLBARS = {
  full: [
    "headings",
    "bold",
    "italic",
    "strike",
    "|",
    "list",
    "ordered-list",
    "check",
    "outdent",
    "indent",
    "|",
    "quote",
    "code",
    "inline-code",
    "insert-before",
    "insert-after",
    "|",
    "upload",
    "link",
    "table",
    "|",
    "line-theme",
    "edit-mode",
    "both",
    "preview",
    "|",
    "fullscreen",
    "export",
  ],
  slim: [
    "headings",
    "bold",
    "italic",
    "strike",
    "|",
    "list",
    "ordered-list",
    "check",
    "|",
    "quote",
    "code",
    "inline-code",
    "|",
    "upload",
    "link",
    "table",
  ],
} as const;

export function VditorEditor({ value, onChange, onSave, placeholder, className, toolbar = "full", height }: VditorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Vditor instance lives outside React; keep refs to avoid re-init loops
  const vditorRef = useRef<Vditor | null>(null);
  // vditor's async init (lute wasm) must finish before setValue is safe;
  // values arriving earlier are buffered and flushed from `after`
  const readyRef = useRef(false);
  const pendingValueRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);

  // keep the latest callbacks reachable from the editor's own listeners
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    if (!hostRef.current || vditorRef.current) return;
    const vd = new Vditor(hostRef.current, {
      cdn: "/vditor",
      mode: "ir",
      lang: "zh_CN",
      placeholder,
      value,
      // explicit height (e.g. "100%" inside a flex pane) — vditor applies it
      // itself on the host element during UI init, so it always wins
      height: height ?? "auto",
      cache: { enable: false },
      counter: { enable: true },
      preview: {
        hljs: { lineNumber: false },
        math: { engine: "KaTeX" },
      },
      toolbar: [...TOOLBARS[toolbar]],
      upload: {
        // paste/drop uploads post to our media endpoint (field: file, → {url});
        // map the response into Vditor's succMap shape so the markdown gets
        // the image link inserted automatically
        url: "/api/media/upload",
        fieldName: "file",
        max: 10 * 1024 * 1024,
        accept: "image/*",
        format: (files: File[] | string, responseText: string) => {
          try {
            const res = JSON.parse(responseText) as { url?: string; filename?: string; error?: string };
            if (!res.url) return JSON.stringify({ code: -1, msg: res.error ?? "上传失败" });
            const fallback = Array.isArray(files) ? (files[0]?.name ?? "image") : String(files);
            const name = res.filename || fallback || "image";
            return JSON.stringify({
              code: 0,
              data: { errFiles: [], succMap: { [name]: res.url } },
            });
          } catch {
            return JSON.stringify({ code: -1, msg: "上传失败" });
          }
        },
      },
      input: (md) => {
        valueRef.current = md ?? "";
        onChangeRef.current(md ?? "");
      },
      after: () => {
        readyRef.current = true;
        const pending = pendingValueRef.current;
        pendingValueRef.current = null;
        if (pending !== null && vd.getValue() !== pending) {
          vd.setValue(pending);
        }
      },
      // ⌘S → save draft through the host handler
      ctrlEnter: undefined,
    });
    vditorRef.current = vd;

    // forward ⌘S / Ctrl+S from inside the editor surface; also flush the
    // latest markdown on blur so the host state is never behind the editor
    const host = hostRef.current;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        onSaveRef.current?.();
      }
    };
    const onBlur = () => {
      const current = vd.getValue();
      if (current !== valueRef.current) {
        valueRef.current = current;
        onChangeRef.current(current ?? "");
      }
    };
    host.addEventListener("keydown", onKey, true);
    host.addEventListener("blur", onBlur, true);

    return () => {
      host.removeEventListener("keydown", onKey, true);
      host.removeEventListener("blur", onBlur, true);
      // Vditor 完成异步初始化（lute wasm）之前调用 destroy 会在内部引用
      // 尚未挂载的 DOM 而抛错 — 未就绪时直接丢弃实例即可
      if (readyRef.current) {
        try {
          vd.destroy();
        } catch {
          // teardown race (unmount during init) — nothing left to clean
        }
      }
      vditorRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  // external value changes (e.g. async draft handoff) sync into the editor
  useEffect(() => {
    if (!vditorRef.current) return;
    if (value === valueRef.current) return;
    if (!readyRef.current) {
      // buffer until vditor's `after` fires — setValue before that crashes
      pendingValueRef.current = value;
      return;
    }
    vditorRef.current.setValue(value);
    valueRef.current = value;
  }, [value]);

  return <div ref={hostRef} className={cn("vditor-host min-h-0", className)} />;
}
