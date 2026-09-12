"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import {
  EmptyState,
  SeverityBadge,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { ConfirmDialog } from "@/components/admin/post-actions";
import { api } from "@/components/admin/client";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface KeywordItem {
  id: string;
  word: string;
  severity: "block" | "warn";
  category: string;
  createdAt: string;
}

/** 关键词黑名单：列表 + 添加 + 批量导入 + 删除。 */
export function ModerationKeywordsTab() {
  const { locale } = useI18n();
  const [items, setItems] = useState<KeywordItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [severity, setSeverity] = useState<"block" | "warn">("block");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KeywordItem | null>(null);

  // bulk import dialog
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSeverity, setBulkSeverity] = useState<"block" | "warn">("block");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(() => {
    api<{ items: KeywordItem[] }>("/api/admin/keywords?limit=100")
      .then((d) => setItems(d.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!word.trim()) return;
    setAdding(true);
    try {
      await api("/api/admin/keywords", {
        method: "POST",
        body: JSON.stringify({ word: word.trim(), severity, category: category.trim() || undefined }),
      });
      toast.success("关键词已添加");
      setWord("");
      setCategory("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function remove(kw: KeywordItem) {
    try {
      await api(`/api/admin/keywords/${kw.id}`, { method: "DELETE" });
      toast.success("已删除");
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function bulkImport() {
    const words = bulkText
      .split("\n")
      .map((w) => w.trim())
      .filter(Boolean);
    if (!words.length) {
      toast.error("请输入至少一个关键词");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await api<{ inserted: number; skipped: number }>("/api/admin/keywords/bulk", {
        method: "POST",
        body: JSON.stringify({ words, severity: bulkSeverity }),
      });
      toast.success(`导入完成：新增 ${res.inserted} 个，跳过重复 ${res.skipped} 个`);
      setBulkOpen(false);
      setBulkText("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          「禁止」级命中后直接拒绝发布；「警告」级命中转人工审核
        </p>
        <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
          <Upload className="size-3.5" />
          批量导入
        </Button>
      </div>

      {/* add row */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <div className="min-w-40 flex-1">
          <Label className="mb-1 block text-xs text-muted-foreground">关键词</Label>
          <Input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="输入关键词后回车"
          />
        </div>
        <div className="w-32">
          <Label className="mb-1 block text-xs text-muted-foreground">级别</Label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as "block" | "warn")}
            className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="关键词级别"
          >
            <option value="block">禁止发布</option>
            <option value="warn">警告提示</option>
          </select>
        </div>
        <div className="w-36">
          <Label className="mb-1 block text-xs text-muted-foreground">分类（可选）</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="general" />
        </div>
        <Button onClick={add} disabled={adding || !word.trim()}>
          {adding ? "添加中…" : "添加"}
        </Button>
      </div>

      {/* list */}
      {error ? (
        <EmptyState title="加载失败" hint={error} />
      ) : !items ? (
        <TableSkeleton rows={5} cols={4} />
      ) : items.length === 0 ? (
        <EmptyState title="黑名单还是空的" hint="添加关键词，或使用批量导入" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>关键词</th>
              <th>级别</th>
              <th>分类</th>
              <th className="text-right">添加时间</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {items.map((kw) => (
              <tr key={kw.id}>
                <td className="font-medium">{kw.word}</td>
                <td>
                  <SeverityBadge severity={kw.severity} />
                </td>
                <td>
                  <Badge variant="outline">{kw.category}</Badge>
                </td>
                <td className="whitespace-nowrap text-right text-xs text-muted-foreground">
                  {formatDate(kw.createdAt, locale)}
                </td>
                <td className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`删除 ${kw.word}`}
                    onClick={() => setDeleteTarget(kw)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {/* bulk import dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量导入关键词</DialogTitle>
            <DialogDescription>每行一个关键词，重复词会自动跳过。</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"spam-link-01\nfake-giveaway\ntest-banned"}
            className="font-mono text-xs"
          />
          <div className="w-40">
            <Label className="mb-1 block text-xs text-muted-foreground">统一级别</Label>
            <select
              value={bulkSeverity}
              onChange={(e) => setBulkSeverity(e.target.value as "block" | "warn")}
              className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              aria-label="批量级别"
            >
              <option value="block">禁止发布</option>
              <option value="warn">警告提示</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
              取消
            </Button>
            <Button onClick={bulkImport} disabled={bulkBusy || !bulkText.trim()}>
              {bulkBusy ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        title="删除该关键词？"
        description={deleteTarget ? `「${deleteTarget.word}」将从黑名单移除。` : undefined}
        confirmText="删除"
        destructive
        pending={false}
        onConfirm={() => {
          if (deleteTarget) remove(deleteTarget);
        }}
      />
    </div>
  );
}
