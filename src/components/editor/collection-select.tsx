"use client";

import { useEffect, useState } from "react";
import { Check, FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CollectionItem {
  id: string;
  name: string;
}

/**
 * Collection picker for the publish-settings panel: loads the user's
 * collections (GET /api/posts/collections), supports inline creation
 * (POST /api/posts/collections). `value` is collectionId | null.
 */
export function CollectionSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/posts/collections")
      .then(async (res) => (res.ok ? ((await res.json()) as { items: CollectionItem[] }) : null))
      .then((data) => {
        if (alive) setItems(data?.items ?? []);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/posts/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json()) as CollectionItem & { error?: string };
      if (!res.ok || !data?.id) throw new Error(data?.error ?? t("common.error"));
      setItems((prev) => [data, ...prev.filter((c) => c.id !== data.id)]);
      onChange(data.id);
      setCreating(false);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

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
                void create();
              } else if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
          />
          <Button type="button" size="icon-sm" disabled={saving || !name.trim()} onClick={() => void create()}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
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
