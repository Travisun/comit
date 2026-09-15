"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, deleteJsonSafe, patchJsonSafe, postJsonSafe } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
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
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const [busy, setBusy] = useState(false);

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

  async function createPost(collectionId: string | null) {
    setBusy(true);
    try {
      const r = await postJsonSafe<{ id?: string; error?: string }>("/api/posts", {
        type: "article",
        title: "无标题",
        content: "",
        action: "draft",
        collectionId,
      });
      if (!r.ok) {
        toast.error(r.error ?? "创建失败");
        return;
      }
      if (!r.data.id) {
        toast.error("创建失败");
        return;
      }
      router.push(routes.editorEdit(r.data.id));
    } catch {
      toast.error("创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createCollection() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await postJsonSafe<CollectionItem & { error?: string }>("/api/posts/collections", {
        name: newName.trim(),
      });
      if (!r.ok) {
        toast.error(r.error ?? "创建目录失败");
        return;
      }
      const col = r.data;
      if (!col?.id) {
        toast.error("创建目录失败");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      setOpenFolders((f) => ({ ...f, [col.id]: true }));
      setNewName("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function renameCollection(id: string) {
    if (!renameValue.trim()) return;
    setBusy(true);
    try {
      const r = await patchJsonSafe<CollectionItem & { error?: string }>(`/api/posts/collections/${id}`, {
        name: renameValue.trim(),
      });
      if (!r.ok) {
        toast.error(r.error ?? "重命名失败");
        return;
      }
      const col = r.data;
      if (!col?.id) {
        toast.error("重命名失败");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      setRenamingId(null);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCollection(id: string) {
    if (!window.confirm("删除目录？目录内文章将移至「未分类」。")) return;
    setBusy(true);
    try {
      const r = await deleteJsonSafe(`/api/posts/collections/${id}`);
      if (!r.ok) {
        toast.error("删除失败");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
    } finally {
      setBusy(false);
    }
  }

  const uncategorized = posts.filter((p) => !p.collectionId);

  const folderRow = (id: string | null, label: string, empty?: boolean) => {
    const open = openFolders[id ?? "none"] ?? false;
    const items = posts.filter((p) => (p.collectionId ?? "none") === (id ?? "none"));
    const isRenaming = renamingId === id;
    return (
      <div key={id ?? "none"}>
        <div
          role="treeitem"
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
                  if (e.key === "Enter") void renameCollection(id!);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="h-6 w-full min-w-0 rounded border border-input bg-card px-1 text-sm outline-none"
              />
              <button
                type="button"
                aria-label="确认重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  void renameCollection(id!);
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
                    void createPost(id);
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
                    void deleteCollection(id!);
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
          onClick={() => void createPost(null)}
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
                    if (e.key === "Enter") void createCollection();
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
                  onClick={() => void createCollection()}
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
