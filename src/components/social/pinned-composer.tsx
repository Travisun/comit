"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Check,
  Eye,
  Hash,
  ImagePlus,
  Loader2,
  Maximize2,
  Minimize2,
  PenLine,
  RotateCcw,
  Send,
  Smile,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { VirtualSelect } from "@/components/ui/virtual-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { CONTENT_LABELS, type ContentLabelId } from "@/lib/content-labels";
import { validatePollEndsAt, validatePollOptions } from "@/lib/poll";
import {
  ApiError,
  SHORT_DRAFT_KEY,
  apiGet,
  isAuthError,
  mediaUrl,
  postJson,
  requestJson,
} from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { BlockedDialog } from "../editor/blocked-dialog";
import {
  AnchoredPanel,
  EmojiPopover,
  insertAtCursor,
  PollPopover,
  TopicPopover,
  type PollDraft,
} from "./composer-panels";
import { PinnedBar } from "./pinned-bar";

/** mirrors SHORT_CONTENT_MAX on the server */
const SHORT_MAX = 8000;
/** mirrors mediaPaths max on the server */
const MAX_IMAGES = 9;
/** counter turns warning this many chars before the limit */
const WARN_AT = 7600;
/** mirrors posts.title varchar(200) on the server */
const TITLE_MAX = 200;
/** mirrors topicNamesSchema (≤5 topics × 60 chars) on the server */
const TOPIC_MAX = 5;
/** 展开态输入区最大高度（视口占比，全屏模式不设限） */
const MAX_GROW_RATIO = 0.75;

type ImgStatus = "uploading" | "done" | "error";

interface ImgItem {
  key: string;
  status: ImgStatus;
  url?: string;
  /** kept in memory so a failed tile can retry */
  file?: File;
}

interface ShortDraft {
  title: string;
  content: string;
  images: { url: string }[];
}

function readShortDraft(): ShortDraft | null {
  try {
    const raw = localStorage.getItem(SHORT_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as ShortDraft;
    if (d.content || d.title || (d.images?.length ?? 0) > 0) return d;
  } catch {
    // corrupted draft — start clean
  }
  return null;
}

/** 正文里的 #话题 标签（发布时解析为话题，最多 5 个；去掉尾部标点） */
function extractHashtags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[#＃]([^\s#＃]{1,60})/g)) {
    const name = m[1].trim().replace(/[，。！？!?.,、]+$/g, "");
    if (name) out.push(name);
  }
  return [...new Set(out)];
}

/**
 * The home composer, pinned to the bottom of the panel at all times.
 * 可选标题与正文同处一个无边框输入区（placeholder 区分身份）；快捷动作：
 * 图片 / 表情 / # 话题（弹出选择面板）/ 投票（弹出设置面板）/ 全屏写作
 * （铅笔，动画展开为全屏宽度，右上角关闭收回）。发布按钮左侧是查看权限
 * 与内容标注下拉（虚拟面板）。输入区随内容自动增高，上限 75% 视口高度。
 *
 * Keyboard: Enter sends · Ctrl/⌘+Enter and Shift+Enter insert a newline
 * (IME-composition safe). Drafts autosave to localStorage, so collapsing or
 * navigating away never destroys work.
 */
export function PinnedComposer({
  user,
  initialExpanded = false,
}: {
  user: { displayName: string; username: string; avatarPath: string | null };
  initialExpanded?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const zh = locale === "zh";

  // Hydration-safe：首渲状态必须与 SSR 一致，渲染期不读 localStorage；
  // 已保存的草稿在挂载后的 effect 里恢复（见 draft autosave 段）。
  const [expanded, setExpanded] = useState(initialExpanded);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<ImgItem[]>([]);

  /* 发布设置 */
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [label, setLabel] = useState<ContentLabelId>("original");
  const [sourceUrl, setSourceUrl] = useState("");
  const [poll, setPoll] = useState<PollDraft | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  /* Markdown / 预览 */
  const [preview, setPreview] = useState(false);
  /** 标题输入：点进 composer（正文聚焦）后才展示；失焦且为空时收回 */
  const [showTitle, setShowTitle] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [composing, setComposing] = useState(false); // IME 组字期间关闭话题高亮镜像

  /* 面板 / 全屏 */
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenClosing, setFullscreenClosing] = useState(false);
  const [topicOpen, setTopicOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  /** # 插入点：话题面板选中后从这里补全 */
  const topicAnchorRef = useRef<number | null>(null);

  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draftSaved, setDraftSaved] = useState<Date | null>(null);
  const loadedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const topicBtnRef = useRef<HTMLButtonElement | null>(null);
  const pollBtnRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const collectionRef = useRef<HTMLDivElement | null>(null);

  // deep link (?compose=1) or restored draft → the composer starts expanded
  // and the caret goes straight into the textarea.
  const focusCaret = useCallback(() => {
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = taRef.current;
      if (el) {
        el.focus();
        return;
      }
      if (++tries < 30) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!initialExpanded) return;
    focusCaret();
  }, [initialExpanded, focusCaret]);

  // 创作 triggers on the home page ping the composer through this event
  useEffect(() => {
    const onFocus = () => {
      setExpanded(true);
      focusCaret();
    };
    window.addEventListener("composer:focus", onFocus);
    return () => window.removeEventListener("composer:focus", onFocus);
  }, [focusCaret]);

  /* --------------------------- draft autosave ---------------------------- */

  useEffect(() => {
    // 挂载后再读 localStorage 恢复草稿（渲染期读会造成 hydration mismatch）；
    // 有草稿则填回输入区并展开 composer，提示一次。
    // 「外部系统（localStorage）→ 本地状态」的挂载初始化，属 effect 合法
    // 用途；新 lint 规则不识别该模式，显式豁免（同 post-tree.tsx）。
    const draft = readShortDraft();
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time restore
      setTitle(draft.title ?? "");
      setContent(draft.content ?? "");
      setImages(
        (draft.images ?? [])
          .filter((i) => i?.url)
          .map((i) => ({ key: `restored-${i.url}`, status: "done", url: i.url! })),
      );
      setShowTitle(Boolean(draft.title));
      setExpanded(true);
      toast.message(zh ? "已恢复上次未发布的草稿" : "Restored your unpublished draft");
    }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore + toast once on mount
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const doneImages = images
          .filter((i) => i.status === "done" && i.url)
          .map((i) => ({ url: i.url! }));
        if (title.trim() || content.trim() || doneImages.length > 0) {
          localStorage.setItem(
            SHORT_DRAFT_KEY,
            JSON.stringify({ title, content, images: doneImages } satisfies ShortDraft),
          );
        } else {
          localStorage.removeItem(SHORT_DRAFT_KEY);
        }
        setDraftSaved(new Date());
      } catch {
        // private mode / quota — autosave is best-effort
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [title, content, images]);

  /* --------------------- collections (lazy) & preview -------------------- */

  // 合集列表：与编辑器目录树（post-tree）共用 queryKeys.collections() 同一份
  // 查询缓存 —— 一侧创建后另一侧自动可见；展开后才拉取（enabled 门控，
  // 替代原先 useState+ref 手管的双缓存）。
  const collectionsQ = useQuery({
    queryKey: queryKeys.collections(),
    queryFn: async () =>
      z
        .object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
        .parse(await apiGet<unknown>("/api/posts/collections")).items,
    enabled: expanded,
  });
  const collections = useMemo(() => collectionsQ.data ?? [], [collectionsQ.data]);

  // 预览：与发布同一服务端渲染管线（防抖）；空内容由渲染分支兜底
  useEffect(() => {
    if (!preview || !content.trim()) return;
    let dead = false;
    const timer = setTimeout(() => {
      postJson<{ html?: string }>("/api/markdown/preview", { content })
        .then((d) => {
          if (!dead) setPreviewHtml(d.html ?? "");
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [preview, content]);

  /* --------------------------- expand / collapse ------------------------- */

  const hasContent =
    title.trim().length > 0 ||
    content.trim().length > 0 ||
    images.some((i) => i.status === "done") ||
    poll !== null;

  function expand() {
    setExpanded(true);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function collapse() {
    setExpanded(false);
  }

  // click outside collapses an empty composer; with content it stays (drafts
  // keep working, the form is never lost to a stray click)
  useEffect(() => {
    if (!expanded || hasContent || fullscreen) return;
    const onDocDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) collapse();
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [expanded, hasContent, fullscreen]);

  // auto-grow the textarea: capped at 75% viewport in the pinned bar,
  // full-height flex inside the fullscreen mode
  useEffect(() => {
    const el = taRef.current;
    if (!el || fullscreen) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * MAX_GROW_RATIO))}px`;
  }, [content, expanded, fullscreen, title]);

  // fullscreen 锁定页面滚动
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  function openFullscreen() {
    setFullscreen(true);
    setFullscreenClosing(false);
    requestAnimationFrame(focusCaret);
  }

  function closeFullscreen() {
    // 播放收起动画后卸载覆盖层
    setFullscreenClosing(true);
  }

  /* ------------------------------- uploads ------------------------------- */

  const uploadOne = useCallback(
    async (item: ImgItem) => {
      if (!item.file) return;
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("kind", "inline");
      try {
        const r = await requestJson<{ url: string }>("/api/media/upload", {
          method: "POST",
          body: fd,
        });
        setImages((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, status: "done", url: r.url } : i)),
        );
      } catch (err) {
        if (isAuthError(err)) {
          toast.error(err instanceof Error ? err.message : t("common.error"));
          router.push("/auth/login");
        } else {
          toast.error(t("editor.uploadFail"));
        }
        setImages((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, status: "error" } : i)),
        );
      }
    },
    [router, t],
  );

  const uploadFiles = useCallback(
    (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (files.length > 0 && imgs.length === 0) {
        toast.error(zh ? "仅支持图片文件" : "Only image files are supported");
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        toast.error(zh ? `最多 ${MAX_IMAGES} 张图片` : `Up to ${MAX_IMAGES} images`);
        return;
      }
      if (imgs.length > room) {
        toast.error(
          zh
            ? `最多 ${MAX_IMAGES} 张图片，已保留前 ${room} 张`
            : `Limited to ${MAX_IMAGES} images — kept the first ${room}`,
        );
      }
      const batch: ImgItem[] = imgs.slice(0, room).map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "uploading",
        file: f,
      }));
      setImages((prev) => [...prev, ...batch]);
      for (const item of batch) void uploadOne(item);
    },
    [images.length, uploadOne, zh],
  );

  const retryImage = useCallback(
    (item: ImgItem) => {
      setImages((prev) =>
        prev.map((i) => (i.key === item.key ? { ...i, status: "uploading" } : i)),
      );
      void uploadOne(item);
    },
    [uploadOne],
  );

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) uploadFiles(files);
  }

  /* --------------------------- quick actions ----------------------------- */

  /** 点击话题：选中整个 #token（输入焦点落回正文，可直接替换） */
  function onHashtagClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-start]");
    const ta = taRef.current;
    if (!el || !ta) return;
    e.preventDefault();
    const start = Number(el.dataset.start);
    const len = Number(el.dataset.len ?? 0);
    ta.focus();
    ta.setSelectionRange(start, start + len);
  }

  /** 工具栏 #：在光标处插入 # 并弹出话题面板；选中后从插入点补全为「#名称 」 */
  function openTopicPanel() {
    if (!expanded) expand();
    const el = taRef.current;
    const pos = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? pos;
    topicAnchorRef.current = pos + 1;
    setContent(content.slice(0, pos) + "#" + content.slice(end));
    setTopicOpen(true);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = pos + 1;
    });
  }

  function pickTopic(name: string) {
    const el = taRef.current;
    const anchor = topicAnchorRef.current ?? content.length;
    // 吞掉 # 后已手打的查询词（直到空白）
    let tokenEnd = anchor;
    while (tokenEnd < content.length && !/\s/.test(content[tokenEnd])) tokenEnd += 1;
    setContent(`${content.slice(0, anchor)}${name} ${content.slice(tokenEnd)}`);
    topicAnchorRef.current = null;
    setTopicOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = anchor + name.length + 1;
    });
  }

  // 创建合集：mutation 收编 —— 成功后失效 queryKeys.collections()，依赖
  // useQuery 自动重查出新合集（不再手动 setCollections 前插）。
  const createCollectionMutation = useApiMutation(
    (name: string) => postJson<{ id: string; name: string }>("/api/posts/collections", { name }),
    {
      refresh: false, // 合集不在 RSC 树上，查询缓存失效即可
      invalidate: [queryKeys.collections()],
      successToast: (d) => (zh ? `合集「${d.name}」已创建` : `Collection "${d.name}" created`),
      onSuccess: (d) => {
        setCollectionId(d.id);
        setCreatingCollection(false);
        setNewCollectionName("");
      },
    },
  );

  function createCollection() {
    const name = newCollectionName.trim();
    if (!name || createCollectionMutation.pending) return;
    void createCollectionMutation.mutate(name);
  }

  /* ------------------------------ publishing ----------------------------- */

  // 发布（mutation 收编）：422 审核命中（blocked 词）不走默认错误 toast，
  // 改弹 BlockedDialog；401/403 跳登录。成功后除 RSC 重验外，还失效
  // feedPrefix（跨 scope 时间线）与 myPostListPrefix（我的管理列表）——
  // Query 默认 staleTime 15s，invalidate 让 initialData 窗口内的缓存也立即重查。
  const publishMutation = useApiMutation(
    (input: {
      type: "short";
      action: "submit";
      title?: string;
      content: string;
      visibility: "public" | "followers";
      label: ContentLabelId;
      sourceUrl?: string;
      topicNames: string[];
      collectionId?: string;
      poll?: { mode: PollDraft["mode"]; options: string[]; endsAt: string };
    }) => postJson("/api/posts", input),
    {
      silent: true, // 错误提示由 onError 自定义分支给出
      invalidate: [queryKeys.feedPrefix(), queryKeys.myPostListPrefix()],
      onSuccess: () => {
        setTitle("");
        setContent("");
        setImages([]);
        setPoll(null);
        setSourceUrl("");
        setLabel("original");
        setVisibility("public");
        setCollectionId(null);
        setPreview(false);
        try {
          localStorage.removeItem(SHORT_DRAFT_KEY);
        } catch {
          // ignore
        }
        setDraftSaved(null);
        toast.success(t("feed.publish"));
        if (fullscreen) {
          setFullscreen(false);
          setFullscreenClosing(false);
        }
        collapse();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.body.blocked?.length) {
          setBlocked(err.body.blocked);
          return;
        }
        toast.error(err instanceof Error ? err.message : t("common.error"));
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.push("/auth/login");
        }
      },
    },
  );

  async function publish() {
    if (publishMutation.pending || uploadingCount > 0) return;
    const text = content.trim();
    const done = images.filter((i) => i.status === "done" && i.url);
    if (!title.trim() && !text && done.length === 0 && !poll) return;

    // 投票草稿校验
    if (poll) {
      const optErr = validatePollOptions(poll.options, zh);
      if (optErr) {
        toast.error(optErr);
        return;
      }
      const endErr = validatePollEndsAt(new Date(poll.endsAt), zh);
      if (endErr) {
        toast.error(endErr);
        return;
      }
    }
    // 转载需要原文地址
    if (label === "repost" && !sourceUrl.trim()) {
      toast.error(zh ? "转载内容需填写原文地址" : "Reposts require a source URL");
      return;
    }

    const full =
      done.length > 0
        ? `${text}${text ? "\n\n" : ""}${done.map((i) => `![](${i.url})`).join("\n\n")}`
        : text;
    const tags = extractHashtags(`${title} ${full}`);
    if (tags.length > TOPIC_MAX) {
      toast.error(zh ? `最多 ${TOPIC_MAX} 个话题，已保留前 ${TOPIC_MAX} 个` : `Up to ${TOPIC_MAX} topics — kept the first ${TOPIC_MAX}`);
    }
    void publishMutation.mutate({
      type: "short",
      action: "submit",
      title: title.trim() || undefined,
      content: full,
      visibility,
      label,
      ...(label === "repost" ? { sourceUrl: sourceUrl.trim() } : {}),
      topicNames: tags.slice(0, TOPIC_MAX),
      collectionId: collectionId || undefined,
      ...(poll
        ? { poll: { mode: poll.mode, options: poll.options, endsAt: poll.endsAt } }
        : {}),
    });
  }

  function pickEmoji(emoji: string) {
    insertAtCursor(taRef.current, emoji, content, setContent);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (fullscreen) closeFullscreen();
      else if (!hasContent) collapse();
      return;
    }
    if (e.key !== "Enter") return;
    if (e.shiftKey) return; // newline
    if (e.nativeEvent.isComposing) return; // IME composition — never send
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/⌘+Enter → explicit newline
      insertAtCursor(taRef.current, "\n", content, setContent);
      return;
    }
    void publish();
  }

  /* ------------------------------- render -------------------------------- */

  const uploadingCount = images.filter((i) => i.status === "uploading").length;
  const canPublish =
    (title.trim().length > 0 ||
      content.trim().length > 0 ||
      images.some((i) => i.status === "done") ||
      poll !== null) &&
    uploadingCount === 0;

  /** 输入区（标题 + 正文 + 图片 + 投票条）：无分割线的整体输入面板 */
  const inputArea = (
    <>
      {expanded && showTitle && (
        <div className="relative">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (!title.trim()) setShowTitle(false);
            }}
            placeholder={zh ? "标题" : "Title"}
            maxLength={TITLE_MAX}
            className="w-full border-0 bg-transparent px-3 pr-28 pt-2.5 text-[17px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
          />
          {/* Markdown / 预览 气泡切换（正文右上角） */}
          <div className="absolute right-2 top-2 z-10 inline-flex items-center rounded-full bg-[var(--muted)] p-[2px] text-[11px]">
            <button
              type="button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full px-2 transition-colors",
                !preview ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PenLine className="size-3" aria-hidden /> Markdown
            </button>
            <button
              type="button"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full px-2 transition-colors",
                preview ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="size-3" aria-hidden /> {zh ? "预览" : "Preview"}
            </button>
          </div>
        </div>
      )}
      {expanded &&
        (preview ? (
          /* 预览：与发布同一服务端渲染管线；图片默认居中、合适尺寸 */
          <div
            className={cn(
              "min-h-16 overflow-y-auto px-3 pb-2 pt-1",
              fullscreen && "min-h-0 flex-1",
            )}
            aria-live="polite"
          >
            {content.trim() ? (
              previewHtml ? (
                <div
                  className={cn(
                    "article-prose max-w-none text-[15px] leading-[1.7]",
                    "[&_img]:mx-auto [&_img]:mt-2 [&_img]:block [&_img]:h-auto [&_img]:max-h-96 [&_img]:w-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border",
                  )}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {zh ? "渲染中…" : "Rendering…"}
                </p>
              )
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {zh ? "暂无内容，切回 Markdown 开始输入" : "Nothing to preview yet"}
              </p>
            )}
          </div>
        ) : (
          <div className="relative">
            <Textarea
              ref={taRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              onFocus={() => setShowTitle(true)}
              onScroll={(e) => {
                if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              placeholder={t("feed.composePlaceholder")}
              maxLength={SHORT_MAX}
              className={cn(
                "relative min-h-16 resize-none overflow-y-auto border-0 bg-transparent px-3 pb-2 pt-1 text-[15px] leading-[1.7] shadow-none focus-visible:shadow-none",
                !composing && "text-transparent caret-[var(--primary)] selection:bg-primary/25 selection:text-transparent",
                fullscreen && "max-h-none min-h-0 flex-1",
              )}
            />
            {/* # 话题高亮镜像层：位于文字之上，话题 span 可 hover 下划线/点击选中
                （IME 组字期间切回原生显示） */}
            <div
              ref={overlayRef}
              aria-hidden
              onClick={onHashtagClick}
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 pb-2 pt-1 text-[15px] leading-[1.7]",
                composing && "invisible",
              )}
            >
              {highlightHashtags(content)}
            </div>
          </div>
        ))}
      {images.length > 0 && (
        <div
          className={cn(
            "mt-1 grid gap-1.5 px-3 pb-1",
            images.length === 1 && "max-w-xs grid-cols-1",
            images.length === 2 && "max-w-md grid-cols-2",
            images.length >= 3 && "max-w-md grid-cols-3",
          )}
        >
          {images.map((item) => (
            <ImageTile
              key={item.key}
              item={item}
              large={images.length === 1}
              removeLabel={t("common.delete")}
              retryLabel={zh ? "重新上传" : "Retry upload"}
              onRemove={() => setImages((prev) => prev.filter((i) => i.key !== item.key))}
              onRetry={() => retryImage(item)}
            />
          ))}
        </div>
      )}
      {poll && expanded && (
        <div className="mx-3 mb-1 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs">
          <BarChart3 className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="font-medium">{poll.mode === "single" ? (zh ? "单选投票" : "Poll") : zh ? "多选投票" : "Multi-choice"}</span>
          <span className="text-muted-foreground">
            {poll.options.length} {zh ? "个选项" : "options"} ·{" "}
            {zh ? "截止 " : "ends "}
            {new Date(poll.endsAt).toLocaleDateString(zh ? "zh-CN" : "en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <button
            type="button"
            aria-label={zh ? "移除投票" : "Remove poll"}
            onClick={() => setPoll(null)}
            className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-destructive"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      )}
      {expanded && label === "repost" && (
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={zh ? "原文地址（转载必填）https://…" : "Source URL (required for reposts)"}
          className="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-md bg-[var(--muted)] px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
        />
      )}
    </>
  );

  /** 工具栏：快捷动作 + 发布设置 + 发布按钮 */
  const toolbar = (
    <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-0.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (!expanded) expand();
            uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <ToolButton
          label={zh ? "图片" : "Image"}
          onClick={() => {
            if (!expanded) expand();
            requestAnimationFrame(() => fileRef.current?.click());
          }}
        >
          <ImagePlus className="size-[18px]" />
        </ToolButton>
        <EmojiPopover label={zh ? "表情" : "Emoji"} onPick={(emoji) => {
          if (!expanded) expand();
          pickEmoji(emoji);
        }}>
          <Smile className="size-[18px]" />
        </EmojiPopover>
        <ToolButton
          ref={topicBtnRef}
          label={zh ? "话题" : "Topic"}
          onClick={openTopicPanel}
          active={topicOpen}
        >
          <Hash className="size-[18px]" />
        </ToolButton>
        <ToolButton
          ref={pollBtnRef}
          label={zh ? "投票" : "Poll"}
          onClick={() => setPollOpen((v) => !v)}
          active={pollOpen || poll !== null}
        >
          <BarChart3 className="size-[18px]" />
        </ToolButton>
        <ToolButton
          label={fullscreen ? (zh ? "退出全屏" : "Exit fullscreen") : zh ? "全屏写作" : "Fullscreen"}
          onClick={() => (fullscreen ? closeFullscreen() : openFullscreen())}
        >
          {fullscreen ? <Minimize2 className="size-[18px]" /> : <PenLine className="size-[18px]" />}
        </ToolButton>
        {uploadingCount > 0 && (
          <span aria-live="polite" className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        {/* 发布按钮左侧：查看权限 / 内容标注 / 合集 —— 紧凑 pill，小屏自动换行 */}
        {expanded && (
          <>
            <VirtualSelect
              value={visibility}
              onChange={(v) => setVisibility(v as "public" | "followers")}
              options={[
                { value: "public", label: zh ? "公开" : "Public" },
                { value: "followers", label: zh ? "关注者" : "Followers" },
              ]}
              className="w-[4.6rem]"
              panelClassName="min-w-36"
              triggerClassName="composer-pill"
              dropUp
            />
            <VirtualSelect
              value={label}
              onChange={(v) => setLabel(v as ContentLabelId)}
              options={CONTENT_LABELS.map((l) => ({ value: l.id, label: zh ? l.name.zh : l.name.en }))}
              className="w-20"
              panelClassName="min-w-40"
              triggerClassName="composer-pill"
              dropUp
            />
            <div ref={collectionRef} className="w-[6.6rem]">
              <VirtualSelect
                value={collectionId ?? ""}
                onChange={(v) => {
                  if (v === "__new") {
                    setCreatingCollection(true);
                    return;
                  }
                  setCollectionId(v || null);
                }}
                options={[
                  { value: "", label: zh ? "合集" : "Collection" },
                  ...collections.map((c) => ({ value: c.id, label: c.name })),
                  { value: "__new", label: `${zh ? "＋ 新建合集" : "＋ New collection"}` },
                ]}
                triggerClassName="composer-pill"
                panelClassName="min-w-44"
                dropUp
              />
            </div>
          </>
        )}
        {content.length > 0 && (
          <span
            className={cn(
              "hidden text-xs tabular-nums sm:inline",
              content.length >= SHORT_MAX
                ? "text-destructive"
                : content.length >= WARN_AT
                  ? "text-[color:var(--warning)]"
                  : "text-muted-foreground",
            )}
          >
            {content.length} / {SHORT_MAX}
          </span>
        )}
        {hasContent && draftSaved && (
          <span className="hidden items-center gap-1 text-xs text-muted-foreground lg:inline-flex">
            <Check className="size-3" aria-hidden />
            {zh ? "已保存" : "Saved"}
          </span>
        )}
        <Button
          type="button"
          size="icon-sm"
          aria-label={t("feed.publish")}
          title={zh ? "Enter 发送 · Shift/Ctrl+Enter 换行" : "Enter to send · Shift/Ctrl+Enter for newline"}
          className="rounded-full"
          disabled={!canPublish || publishMutation.pending}
          onClick={() => void publish()}
        >
          {publishMutation.pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );

  const cardInner = (
    <>
      {inputArea}
      {toolbar}
    </>
  );

  return (
    <>
      {!fullscreen && (
        <PinnedBar>
          <div
            ref={cardRef}
            className={cn(
              "relative rounded-2xl border bg-card/95 shadow-[0_4px_16px_rgba(42,47,69,0.12)] backdrop-blur transition-colors",
              dragOver && "border-primary/50",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOver(false);
            }}
            onDrop={onDrop}
          >
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl bg-card/90">
                <span className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary">
                  {zh ? "松开以添加图片" : "Drop images to attach"}
                </span>
              </div>
            )}
            {!expanded ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <Avatar className="ml-2 size-8 shrink-0">
                  {user.avatarPath && <AvatarImage src={mediaUrl(user.avatarPath)} alt={user.displayName} />}
                  <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={expand}
                  className="h-9 min-w-0 flex-1 rounded-full bg-[var(--muted)] px-4 text-left text-sm text-muted-foreground transition-colors hover:bg-[var(--hover)]"
                >
                  <span className="block truncate">{t("feed.compose")}</span>
                </button>
                <ToolButton label={zh ? "全屏写作" : "Fullscreen"} onClick={openFullscreen}>
                  <Maximize2 className="size-[18px]" />
                </ToolButton>
              </div>
            ) : (
              cardInner
            )}
          </div>
          <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
        </PinnedBar>
      )}

      {/* 全屏写作：动画展开为全屏宽度，右上角关闭收回到底部输入条 */}
      {fullscreen &&
        createPortal(
          <div
            className={cn(
              "fixed inset-0 z-[70] bg-background",
              fullscreenClosing
                ? "animate-[composer-sink_0.2s_ease-in_forwards]"
                : "animate-[composer-rise_0.28s_cubic-bezier(0.16,1,0.3,1)]",
            )}
            onAnimationEnd={() => {
              if (fullscreenClosing) {
                setFullscreen(false);
                setFullscreenClosing(false);
              }
            }}
          >
            <div className="mx-auto flex h-full w-full max-w-[920px] flex-col px-4 pb-4 pt-3 md:px-6">
              <div className="flex items-center justify-between gap-3 pb-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Maximize2 className="size-4" aria-hidden />
                  {zh ? "全屏写作" : "Compose"}
                </span>
                <button
                  type="button"
                  aria-label={zh ? "收起" : "Collapse"}
                  title={zh ? "收起到底部输入条 (Esc)" : "Collapse (Esc)"}
                  onClick={closeFullscreen}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
                >
                  <X className="size-4.5" />
                </button>
              </div>
              <div
                ref={cardRef}
                className={cn(
                  "flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/95 shadow-[0_4px_16px_rgba(42,47,69,0.12)]",
                  dragOver && "border-primary/50",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragOver) setDragOver(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragOver(false);
                }}
                onDrop={onDrop}
              >
                {cardInner}
              </div>
            </div>
            <BlockedDialog blocked={blocked} onClose={() => setBlocked(null)} />
          </div>,
          document.body,
        )}

      {/* 话题 / 投票 tooltip 面板（锚定到工具栏按钮；条件挂载即每次全新状态） */}
      {topicOpen && (
        <TopicPopover
          zh={zh}
          anchorRef={topicBtnRef}
          open
          onClose={() => {
            setTopicOpen(false);
            topicAnchorRef.current = null;
          }}
          onPick={pickTopic}
        />
      )}
      {pollOpen && (
        <PollPopover
          zh={zh}
          anchorRef={pollBtnRef}
          open
          initial={poll}
          onClose={() => setPollOpen(false)}
          onCommit={(d) => setPoll(d)}
          onRemove={() => setPoll(null)}
        />
      )}
      {creatingCollection && (
        <AnchoredPanel
          anchorRef={collectionRef}
          open
          onClose={() => setCreatingCollection(false)}
          label={zh ? "新建合集" : "New collection"}
          width={300}
        >
          {/* 单行布局：名称输入 + 取消 + 创建 */}
          <div className="flex items-center gap-1.5 p-2">
            <input
              autoFocus
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createCollection();
                } else if (e.key === "Escape") {
                  setCreatingCollection(false);
                  setNewCollectionName("");
                }
              }}
              placeholder={zh ? "合集名称，回车创建" : "Collection name — Enter"}
              maxLength={120}
              className="h-7 min-w-0 flex-1 rounded-full bg-[var(--muted)] px-2.5 text-xs outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              aria-label={zh ? "取消" : "Cancel"}
              title={zh ? "取消" : "Cancel"}
              onClick={() => {
                setCreatingCollection(false);
                setNewCollectionName("");
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={zh ? "创建" : "Create"}
              title={zh ? "创建" : "Create"}
              onClick={() => void createCollection()}
              disabled={createCollectionMutation.pending || !newCollectionName.trim()}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {createCollectionMutation.pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
            </button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

/* --------------------------- hashtag highlight ----------------------------- */

const HASHTAG_RE = /[#＃]([^\s#＃]{1,60})/g;

/** # 话题高亮分段（镜像层渲染；与发布时的解析保持同一语义）。
 *  span 可接收 hover/点击（data-start/data-len 记录原文位置）。 */
function highlightHashtags(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(HASHTAG_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <span
        key={k++}
        data-start={i}
        data-len={m[0].length}
        className="pointer-events-auto cursor-pointer select-none rounded-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}


/* ----------------------------- tool button -------------------------------- */

function ToolButton({
  label,
  onClick,
  active = false,
  children,
  ref,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-expanded={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
        active
          ? "bg-[var(--selected)] text-foreground"
          : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- image tile ------------------------------- */

function ImageTile({
  item,
  large,
  removeLabel,
  retryLabel,
  onRemove,
  onRetry,
}: {
  item: { status: string; url?: string };
  large: boolean;
  removeLabel: string;
  retryLabel: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={cn("group/tile relative", large ? "aspect-[4/3]" : "aspect-square")}>
      {item.status === "done" && item.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(item.url)}
          alt=""
          className="size-full rounded-lg border border-border object-cover"
        />
      ) : item.status === "uploading" ? (
        <div
          aria-live="polite"
          className="grid size-full animate-pulse place-items-center rounded-lg border border-border bg-[var(--muted)] text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </div>
      ) : (
        <div className="grid size-full place-items-center rounded-lg border border-destructive/40 bg-destructive/5">
          <button
            type="button"
            aria-label={retryLabel}
            title={retryLabel}
            onClick={onRetry}
            className="grid size-7 place-items-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className={cn(
          "absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground/90 text-background shadow-sm",
          "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tile:opacity-100 max-md:opacity-100",
        )}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}
