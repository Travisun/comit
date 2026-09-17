"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  apiGet,
  apiUpload,
  isAuthError,
  mediaPathFromUrl,
  mediaUrl,
  postJson,
} from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import { useRealtime } from "@/lib/client/realtime";
import { messagesPageSchema, type MessagesPage, type MessageItem } from "@/lib/models/messages";

export interface ChatPartner {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
}

export function ChatClient({ other }: { other: ChatPartner }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // 会话消息：无限分页（反向游标，fetchNextPage 加载更早消息）+ SSE 实时推送
  // 为主（见下方 useRealtime），60s 轮询仅作兜底（SSE 断线/不可用时保底收
  // 新消息），由 TanStack Query 托管（后台标签页自动暂停）
  const threadQ = useInfiniteQuery({
    queryKey: queryKeys.messages(other.id),
    queryFn: async ({ pageParam }) =>
      messagesPageSchema.parse(
        await apiGet<unknown>(
          pageParam
            ? `/api/messages/${other.id}?cursor=${encodeURIComponent(pageParam)}`
            : `/api/messages/${other.id}`,
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  // 兜底轮询（SSE 断线/不可用时保底收新消息）：只拉第一页做轻量探测，
  // 探测到新消息才失效 thread。直接把 refetchInterval 挂在无限流上会每
  // 60s 重放全部已加载页 —— 用户点过「加载更早」后就是每分钟 N 个请求。
  const checkQ = useQuery({
    queryKey: queryKeys.messagesCheck(other.id),
    queryFn: async () =>
      messagesPageSchema.parse(await apiGet<unknown>(`/api/messages/${other.id}`)),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
  // items 升序（API 内部 page.reverse()），最新消息在末尾
  const newestFromCheck = checkQ.data?.items.at(-1)?.id;
  const newestInThread = threadQ.data?.pages[0]?.items.at(-1)?.id;
  useEffect(() => {
    if (newestFromCheck && newestFromCheck !== newestInThread) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(other.id) });
    }
  }, [newestFromCheck, newestInThread, other.id, queryClient]);

  // 实时接入（单例 SSE 总线）：message.created 的 payload 只有
  // `{ from: senderId, messageId }` —— `from` 等于当前会话对端 id 才是本
  // 线程消息，重拉 thread（GET 会顺带把对方消息标已读）；会话列表预览/未读
  // 则任何消息事件都要失效。realtime.reconnected 补偿断线窗口内的丢失推送。
  useRealtime((event) => {
    if (event.type === "message.created") {
      const p = (event.payload ?? {}) as { from?: string };
      if (p.from === other.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(other.id) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations() });
    } else if (event.type === "message.read") {
      // 已读回执（bus payload 形状 { userId: 读者, peerId }，只读参考）
      const p = (event.payload ?? {}) as { userId?: string; peerId?: string };
      if (p.userId === other.id || p.peerId === other.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(other.id) });
      }
    } else if (event.type === "realtime.reconnected") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(other.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations() });
    }
  });

  // 末页游标 — 还有更早消息时头部显示「加载更多」
  const olderCursor = threadQ.data?.pages[threadQ.data.pages.length - 1]?.nextCursor ?? null;
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomAnchor = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomAnchor.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  // 合并全部已加载页（首页 + fetchNextPage 拉到的更早消息），按时间排序去重
  const items = useMemo(() => {
    const map = new Map<string, MessageItem>();
    for (const page of threadQ.data?.pages ?? []) {
      for (const m of page.items) map.set(m.id, m);
    }
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [threadQ.data]);

  // 首次加载数据后滚到底部
  useEffect(() => {
    if (threadQ.data && !scrolledRef.current) {
      scrolledRef.current = true;
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [threadQ.data, scrollToBottom]);

  // 新消息到达（轮询/发送）且视口在底部时跟随滚动
  useEffect(() => {
    if (items.length > 0 && atBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    }
  }, [items, scrollToBottom]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // 加载更早消息（fetchNextPage 收编原手工翻页）：加载完成后补偿高度差，
  // 让视口停留在原消息位置（滚动跟随）
  async function loadOlder() {
    if (!olderCursor || threadQ.isFetchingNextPage) return;
    const prevHeight = containerRef.current?.scrollHeight ?? 0;
    const res = await threadQ.fetchNextPage();
    if (res.isError) {
      toast.error(res.error instanceof Error ? res.error.message : t("common.error"));
      return;
    }
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }

  // 发消息（mutation 收编）：静默失败（onError 自行 toast + 登录跳转），
  // 成功后 setQueryData 把新消息增量插入 thread 缓存末页（对齐 comments.tsx
  // 的提交模式）→ items 派生更新 → 底部跟随滚动；refresh 关闭（本页无
  // RSC 关系数据），仅失效会话列表让预览/未读同步推进。
  const sendMutation = useApiMutation(
    (payload: { body?: string; mediaPath?: string }) =>
      postJson<MessageItem>(`/api/messages/${other.id}`, payload),
    {
      silent: true,
      refresh: false,
      invalidate: [queryKeys.conversations()],
      onSuccess: (created) => {
        queryClient.setQueryData<InfiniteData<MessagesPage>>(queryKeys.messages(other.id), (prev) =>
          prev
            ? {
                ...prev,
                pages: prev.pages.map((p, i) =>
                  i === prev.pages.length - 1 ? { ...p, items: [...p.items, created] } : p,
                ),
              }
            : prev,
        );
        atBottomRef.current = true;
        requestAnimationFrame(() => scrollToBottom("smooth"));
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : t("common.error"));
        if (isAuthError(err)) router.push("/auth/login");
      },
    },
  );

  async function send(payload: { body?: string; mediaPath?: string }) {
    if (sendMutation.pending) return;
    await sendMutation.mutate(payload);
  }

  async function sendText() {
    const text = input.trim();
    if (!text || sendMutation.pending) return;
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
      const r = await apiUpload<{ url: string }>("/api/media/upload", fd);
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) toast.error(r.error ?? t("common.error"));
        else toast.error(t("editor.uploadFail"));
        return;
      }
      await send({ mediaPath: mediaPathFromUrl(r.data.url) });
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
              disabled={threadQ.isFetchingNextPage}
            >
              {threadQ.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
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
          disabled={uploading || sendMutation.pending}
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
          disabled={!input.trim() || sendMutation.pending || uploading}
          onClick={() => void sendText()}
        >
          {sendMutation.pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
