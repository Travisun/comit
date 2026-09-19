"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiGet, deleteJson, patchJson, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Notes-style directory tree for the article editor:
 *   collections = folders (create / rename / delete via hover actions)
 *   articles    = leaves grouped by folder (未分类 for loose posts)
 * Clicking a folder's "＋" creates a new article in that folder; clicking a
 * leaf opens it in the editor.
 */

interface CollectionItem {
  id: string;
  name: string;
}

interface TreePost {
  id: string;
  title: string | null;
  status: "draft" | "pending_review" | "published" | "rejected";
  collectionId: string | null;
}

const STATUS_DOT: Record<TreePost["status"], string> = {
  draft: "bg-[var(--muted-foreground)]",
  pending_review: "bg-[var(--warning)]",
  published: "bg-[var(--success)]",
  rejected: "bg-[var(--destructive)]",
};

const collectionItemSchema = z.object({ id: z.string(), name: z.string() });
const treePostSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["draft", "pending_review", "published", "rejected"]),
  collectionId: z.string().nullable(),
});

export function PostTree({ activeId }: { activeId?: string | null }) {
  const confirm = useConfirmDialog();
  const router = useRouter();
  const collectionsQ = useQuery({
    queryKey: queryKeys.collections(),
    queryFn: async () =>
      z
        .object({ items: z.array(collectionItemSchema) })
        .parse(await apiGet<unknown>("/api/posts/collections")).items,
  });
  const postsQ = useQuery({
    queryKey: queryKeys.myPosts("article"),
    queryFn: async () =>
      z
        .object({ items: z.array(treePostSchema) })
        .parse(await apiGet<unknown>("/api/posts/mine?type=article&limit=200")).items,
  });
  const collections = useMemo(() => collectionsQ.data ?? [], [collectionsQ.data]);
  const posts = useMemo(() => postsQ.data ?? [], [postsQ.data]);
  const loading = collectionsQ.isLoading || postsQ.isLoading;
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // collapse folders without the active post; open the one containing it
  // （打开态是用户可改的本地状态，这里做「props → 派生 UI 状态」同步，
  // 属于 effect 的合法用途；新 lint 规则不识别该模式，显式豁免）
  useEffect(() => {
    if (!activeId || !posts.length) return;
    const active = posts.find((p) => p.id === activeId);
    if (active)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenFolders((f) => ({ ...f, [active.collectionId ?? "none"]: true }));
  }, [activeId, posts]);

  // 新建文章 — 成功跳编辑器；silent + onError 保持原失败文案
  // （服务端错误取 message，其余回落「创建失败」）
  const createPostMut = useApiMutation(
    async (collectionId: string | null) => {
      const data = await postJson<{ id?: string }>("/api/posts", {
        type: "article",
        title: "无标题",
        content: "",
        action: "draft",
        collectionId,
      });
      if (!data?.id) throw new Error("创建失败");
      return data.id;
    },
    {
      silent: true,
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "创建失败"),
      onSuccess: (id) => router.push(routes.editorEdit(id)),
    },
  );

  // 新建目录 — 成功失效 queryKeys.collections()（与 collection-select /
  // pinned-composer 共用的缓存自动重取）
  const createCollectionMut = useApiMutation(
    async (name: string) => {
      const data = await postJson<CollectionItem>("/api/posts/collections", { name });
      if (!data?.id) throw new Error("创建目录失败");
      return data;
    },
    {
      silent: true,
      invalidate: [queryKeys.collections()],
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "创建目录失败"),
      onSuccess: (col) => {
        setOpenFolders((f) => ({ ...f, [col.id]: true }));
        setNewName("");
        setCreating(false);
      },
    },
  );

  const renameCollectionMut = useApiMutation(
    async ({ id, name }: { id: string; name: string }) => {
      const data = await patchJson<CollectionItem>(`/api/posts/collections/${id}`, { name });
      if (!data?.id) throw new Error("重命名失败");
      return data;
    },
    {
      silent: true,
      invalidate: [queryKeys.collections()],
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "重命名失败"),
      onSuccess: () => setRenamingId(null),
    },
  );

  const deleteCollectionMut = useApiMutation(
    (id: string) => deleteJson(`/api/posts/collections/${id}`),
    {
      silent: true,
      invalidate: [queryKeys.collections()],
      onError: () => toast.error("删除失败"),
    },
  );

  // 等价原手写 busy：任一 mutation 进行中即禁用写操作按钮
  const busy =
    createPostMut.pending ||
    createCollectionMut.pending ||
    renameCollectionMut.pending ||
    deleteCollectionMut.pending;

  function createPost(collectionId: string | null) {
    void createPostMut.mutate(collectionId);
  }

  function createCollection() {
    const name = newName.trim();
    if (!name || busy) return;
    void createCollectionMut.mutate(name);
  }

  function renameCollection(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    void renameCollectionMut.mutate({ id, name });
  }

  async function deleteCollection(id: string) {
    if (!(await confirm({ title: "删除目录？", description: "目录内文章将移至「未分类」。", confirmLabel: "删除", danger: true }))) return;
    void deleteCollectionMut.mutate(id);
  }

  const folderRow = (id: string | null, label: string, empty?: boolean) => {
    const open = openFolders[id ?? "none"] ?? false;
    const items = posts.filter((p) => (p.collectionId ?? "none") === (id ?? "none"));
    const isRenaming = renamingId === id;
    return (
      <div key={id ?? "none"}>
        <div
          role="treeitem"
          aria-selected={false}
          aria-expanded={open}
          tabIndex={0}
          onClick={() => setOpenFolders((f) => ({ ...f, [id ?? "none"]: !open }))}
          className="group flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-sm text-[color:var(--text-body)] transition-colors hover:bg-[var(--hover)]"
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          {open ? (
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
          )}
          {isRenaming ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameCollection(id!);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="h-6 w-full min-w-0 rounded border border-input bg-card px-1 text-sm outline-none"
              />
              <button
                type="button"
                aria-label="确认重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  renameCollection(id!);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="取消"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <span className={cn("min-w-0 flex-1 truncate", empty && "text-muted-foreground")}>{label}</span>
          )}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            {!isRenaming && !empty && (
              <>
                <button
                  type="button"
                  aria-label={`在「${label}」中新建文章`}
                  title="在此目录新建文章"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    createPost(id);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-[var(--selected)] hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="重命名目录"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(id);
                    setRenameValue(label);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-[var(--selected)] hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="删除目录"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCollection(id!);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-[var(--selected)] hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
          </span>
          {!empty && (
            <span className="shrink-0 text-xs text-muted-foreground group-hover:hidden">{items.length}</span>
          )}
        </div>

        {open && (
          <div role="group" className="ml-4 border-l border-border pl-2">
            {items.length === 0 ? (
              <p className="py-1.5 pl-2 text-xs text-muted-foreground">
                {empty ? "还没有文章" : "空目录"}
              </p>
            ) : (
              items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(routes.editorEdit(p.id))}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                    p.id === activeId
                      ? "bg-[var(--selected)] font-medium text-foreground"
                      : "text-[color:var(--text-body)] hover:bg-[var(--hover)]",
                  )}
                >
                  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                  <span className="min-w-0 flex-1 truncate">{p.title || "无标题"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-[var(--background)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-semibold">文章库</span>
        <button
          type="button"
          aria-label="新建文章"
          title="新建文章"
          disabled={busy || creating}
          onClick={() => createPost(null)}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div role="tree" className="flex flex-col gap-0.5">
            {/* quick create */}
            {creating ? (
              <div className="mb-1 flex items-center gap-1 px-1.5">
                <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createCollection();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  placeholder="目录名称"
                  className="h-7 w-full min-w-0 rounded border border-input bg-card px-1.5 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  aria-label="确认创建目录"
                  onClick={() => createCollection()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="取消"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              >
                <Plus className="size-3.5" />
                新建目录
              </button>
            )}

            {collections.map((c) => folderRow(c.id, c.name))}
            {folderRow(null, "未分类", posts.length === 0)}
          </div>
        )}
      </div>

    </aside>
  );
}
