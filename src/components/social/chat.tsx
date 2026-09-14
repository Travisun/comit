"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  isAuthError,
  mediaPathFromUrl,
  mediaUrl,
  postJson,
  requestJson,
} from "./api";

interface MessageItem {
  id: string;
  body: string | null;
  mediaPath: string | null;
  mine: boolean;
  readAt: string | null;
  createdAt: string;
}

interface MessagesResponse {
  items: MessageItem[];
  nextCursor: string | null;
}

export interface ChatPartner {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
}

export function ChatClient({ other }: { other: ChatPartner }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomAnchor = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomAnchor.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const mergeItems = useCallback((incoming: MessageItem[]) => {
    setItems((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await requestJson<MessagesResponse>(`/api/messages/${other.id}`);
        if (cancelled) return;
        setItems(r.items);
        setOlderCursor(r.nextCursor);
        requestAnimationFrame(() => scrollToBottom());
      } catch {
        // keep empty state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [other.id, scrollToBottom]);

  // 30s polling for new messages
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await requestJson<MessagesResponse>(`/api/messages/${other.id}`);
        mergeItems(r.items);
        if (atBottomRef.current) requestAnimationFrame(() => scrollToBottom("smooth"));
      } catch {
        // ignore polling failures
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [other.id, mergeItems, scrollToBottom]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    if (!olderCursor || loadingOlder) return;
    const el = containerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const r = await requestJson<MessagesResponse>(
        `/api/messages/${other.id}?cursor=${encodeURIComponent(olderCursor)}`,
      );
      mergeItems(r.items);
      setOlderCursor(r.nextCursor);
      requestAnimationFrame(() => {
        const el2 = containerRef.current;
        if (el2) el2.scrollTop += el2.scrollHeight - prevHeight;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(payload: { body?: string; mediaPath?: string }) {
    if (sending) return;
    setSending(true);
    try {
      const created = await postJson<MessageItem>(`/api/messages/${other.id}`, payload);
      setItems((prev) => [...prev, created]);
      atBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) router.push("/auth/login");
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    await send({ body: text });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendText();
    }
  }

  async function sendImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "inline");
      const r = await requestJson<{ url: string }>("/api/media/upload", {
        method: "POST",
        body: fd,
      });
      await send({ mediaPath: mediaPathFromUrl(r.url) });
    } catch (err) {
      if (isAuthError(err)) {
        toast.error(err instanceof Error ? err.message : t("common.error"));
      } else {
        toast.error(t("editor.uploadFail"));
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => router.push("/messages")}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Link href={`/u/${other.username}`} className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-8 border border-border">
            {other.avatarPath && (
              <AvatarImage src={mediaUrl(other.avatarPath)} alt={other.displayName} />
            )}
            <AvatarFallback>{other.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {other.displayName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              @{other.username}
            </span>
          </span>
        </Link>
      </div>

      {/* messages */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6"
      >
        {olderCursor && (
          <div className="flex justify-center pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder && <Loader2 className="size-3.5 animate-spin" />}
              {t("comments.loadMore")}
            </Button>
          </div>
        )}
        {items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("messages.empty")}</p>
        )}
        {items.map((m) => (
          <div
            key={m.id}
            className={cn("flex items-end gap-2", m.mine ? "justify-end" : "justify-start")}
          >
            {!m.mine && (
              <Avatar className="size-7 border border-border">
                {other.avatarPath && (
                  <AvatarImage src={mediaUrl(other.avatarPath)} alt={other.displayName} />
                )}
                <AvatarFallback>{other.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[65%]",
                m.mine
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-muted text-foreground",
              )}
            >
              {m.mediaPath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(m.mediaPath)}
                  alt=""
                  loading="lazy"
                  className="mb-1 max-h-64 rounded-lg border border-black/10 object-contain"
                />
              )}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {m.mine && (
                <p
                  className={cn(
                    "mt-0.5 text-right text-[10px]",
                    m.mine ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {m.readAt ? (locale === "zh" ? "已读" : "Read") : ""}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomAnchor} />
      </div>

      {/* composer */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void sendImage(f);
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="mb-1 shrink-0 rounded-full"
          aria-label={t("editor.cover")}
          disabled={uploading || sending}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("messages.placeholder")}
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:shadow-none"
          maxLength={2000}
        />
        <Button
          size="icon-sm"
          className="mb-1 shrink-0 rounded-full"
          aria-label={t("messages.send")}
          disabled={!input.trim() || sending || uploading}
          onClick={() => void sendText()}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
