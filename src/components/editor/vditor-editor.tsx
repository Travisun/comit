"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import Vditor from "vditor";
import "vditor/dist/index.css";
import { cn } from "@/lib/utils";
import { uploadImage } from "@/components/editor/upload";
import { toast } from "sonner";

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
  /** "slim" trims the toolbar for compact surfaces (e.g. the composer sheet);
   *  "none" 隐藏工具栏（沉浸写作模式）。 */
  toolbar?: "full" | "slim" | "none";
  /**
   * Explicit height for the editor surface, e.g. "100%" to fill a flex pane
   * (forwarded to Vditor's own `height` option; default "auto").
   */
  height?: string;
  /**
   * 渲染在工具栏与正文之间的内容（如标题输入）—— 通过 portal 插入 vditor
   * 内部 DOM，跟随编辑器全宽贴合。
   */
  children?: ReactNode;
  /** 编程式控制：聚焦正文 / 向光标处插入 markdown。 */
  ref?: Ref<VditorEditorHandle>;
}

export interface VditorEditorHandle {
  focus: () => void;
  insertValue: (md: string) => void;
}

const TOOLBARS = {
  none: [],
  full: [
    "headings",
    "bold",
    "italic",
    "strike",
    "list",
    "ordered-list",
    "check",
    "outdent",
    "indent",
    "quote",
    "code",
    "inline-code",
    "insert-before",
    "insert-after",
    "upload",
    "link",
    "table",
    "line-theme",
    "edit-mode",
    "both",
    "preview",
    "fullscreen",
    "export",
  ],
  slim: [
    "headings",
    "bold",
    "italic",
    "strike",
    "list",
    "ordered-list",
    "check",
    "quote",
    "code",
    "inline-code",
    "upload",
    "link",
    "table",
  ],
} as const;

export function VditorEditor({
  value,
  onChange,
  onSave,
  placeholder,
  className,
  toolbar = "full",
  height,
  children,
  ref,
}: VditorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 工具栏下方的插槽容器：children（标题等）经 portal 渲染到这里
  const [afterToolbarSlot, setAfterToolbarSlot] = useState<HTMLElement | null>(null);
  const afterToolbarSlotRef = useRef<HTMLElement | null>(null);
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
        // paste/drop 上传统一走 editor/upload.ts 的 uploadImage（含预压缩 /
        // HEIC 兜底，与 textarea 模式行为一致），再把结果映射成 Vditor 的
        // succMap 形状让 markdown 自动插入图片链接。Vditor 的内建直传
        // （upload.url）没有压缩环节，已弃用。
        max: 10 * 1024 * 1024,
        accept: "image/*",
        handler: async (files: File[]): Promise<string> => {
          const errFiles: string[] = [];
          const succMap: Record<string, string> = {};
          for (const file of files ?? []) {
            try {
              const res = await uploadImage(file, "inline");
              succMap[file.name || "image"] = res.url;
            } catch (err) {
              console.error("[vditor] upload failed:", err);
              errFiles.push(file.name);
              toast.error(err instanceof Error ? err.message : "上传失败");
            }
          }
          return JSON.stringify({ code: 0, data: { errFiles, succMap } });
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
        createSlotAfterToolbar();
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

    // 工具栏正下方插入插槽容器（跟随 .vditor 的 flex 列布局，全宽）。
    // 构造后与 wasm 就绪（after）各调一次，幂等 —— 异步初始化完成前
    // querySelector 可能找不到工具栏元素。
    const createSlotAfterToolbar = () => {
      if (afterToolbarSlotRef.current) return;
      const toolbar = host.querySelector(".vditor-toolbar");
      if (!toolbar) return;
      const slot = document.createElement("div");
      slot.className = "vditor-after-toolbar-slot";
      toolbar.insertAdjacentElement("afterend", slot);
      afterToolbarSlotRef.current = slot;
      setAfterToolbarSlot(slot);
    };
    createSlotAfterToolbar();

    return () => {
      afterToolbarSlotRef.current = null;
      setAfterToolbarSlot(null);
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

  // 编程式句柄：标题回车聚焦正文、工具扩展插入内容
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const el = hostRef.current?.querySelector<HTMLElement>(".vditor-reset");
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
      insertValue: (md: string) => {
        vditorRef.current?.insertValue(md);
        hostRef.current?.querySelector<HTMLElement>(".vditor-reset")?.focus();
      },
    }),
    [],
  );

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

  return (
    <div
      ref={hostRef}
      className={cn(
        "vditor-host min-h-0",
        toolbar === "none" && "vditor-toolbar-none",
        className,
      )}
    >
      {afterToolbarSlot && children ? createPortal(children, afterToolbarSlot) : null}
    </div>
  );
}
