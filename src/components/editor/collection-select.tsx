"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";
import { Check, FolderPlus, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Collection picker for the publish-settings panel: loads the user's
 * collections (GET /api/posts/collections), supports inline creation
 * (POST /api/posts/collections). `value` is collectionId | null.
 *
 * 读取与 post-tree / pinned-composer 共用 queryKeys.collections() 同一份
 * 查询缓存；创建走 useApiMutation，成功后失效该键让三处同步可见。
 */
export function CollectionSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const collectionsQ = useQuery({
    queryKey: queryKeys.collections(),
    queryFn: async () =>
      z
        .object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
        .parse(await apiGet<unknown>("/api/posts/collections")).items,
  });
  const items = collectionsQ.data ?? [];
  const loading = collectionsQ.isLoading;

  const createMutation = useApiMutation(
    async (trimmed: string) => {
      const data = await postJson<{ id: string; name: string }>("/api/posts/collections", {
        name: trimmed,
      });
      if (!data?.id) throw new Error(t("common.error"));
      return data;
    },
    {
      refresh: false, // 合集不在 RSC 树上，查询缓存失效即可
      invalidate: [queryKeys.collections()],
      onSuccess: (data) => {
        onChange(data.id);
        setCreating(false);
        setName("");
      },
    },
  );

  function create() {
    const trimmed = name.trim();
    if (!trimmed || createMutation.pending) return;
    void createMutation.mutate(trimmed);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {creating ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={name}
            placeholder={t("editor.collectionName")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              } else if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            disabled={createMutation.pending || !name.trim()}
            onClick={create}
          >
            {createMutation.pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={value ?? ""}
            disabled={loading}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
          >
            <option value="">{t("editor.noCollection")}</option>
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title={t("editor.createCollection")}
            aria-label={t("editor.createCollection")}
            onClick={() => setCreating(true)}
          >
            <FolderPlus />
          </Button>
        </div>
      )}
    </div>
  );
}
