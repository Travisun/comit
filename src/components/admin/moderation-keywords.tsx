"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
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
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { deleteJson, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";

/* -------------------------------- schema --------------------------------- */

const keywordItemSchema = z.object({
  id: z.string(),
  word: z.string(),
  severity: z.enum(["block", "warn"]),
  category: z.string(),
  createdAt: z.string(),
});

const keywordsSchema = z.object({ items: z.array(keywordItemSchema) });

type KeywordItem = z.infer<typeof keywordItemSchema>;

/** 关键词黑名单：列表 + 添加 + 批量导入 + 删除。 */
export function ModerationKeywordsTab() {
  const { locale } = useI18n();
  const [word, setWord] = useState("");
  const [severity, setSeverity] = useState<"block" | "warn">("block");
  const [category, setCategory] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<KeywordItem | null>(null);

  // bulk import dialog
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSeverity, setBulkSeverity] = useState<"block" | "warn">("block");

  // 列表查询 — 增删导入后 invalidate 重取，等价原 load()
  const keywordsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminKeywords(),
      url: "/api/admin/keywords?limit=100",
      schema: keywordsSchema,
    }),
  );
  const items = keywordsQ.data?.items;
  const error = keywordsQ.error instanceof Error ? keywordsQ.error.message : null;

  // 添加 — pending 驱动按钮；成功清空输入
  const addMutation = useApiMutation(
    (payload: { word: string; severity: "block" | "warn"; category?: string }) =>
      postJson("/api/admin/keywords", payload),
    {
      refresh: false,
      invalidate: [queryKeys.adminKeywords()],
      successToast: "关键词已添加",
      onSuccess: () => {
        setWord("");
        setCategory("");
      },
    },
  );

  // 删除 — pending 驱动确认按钮
  const removeMutation = useApiMutation(
    (kw: KeywordItem) => deleteJson(`/api/admin/keywords/${kw.id}`),
    {
      refresh: false,
      invalidate: [queryKeys.adminKeywords()],
      successToast: "已删除",
      onSuccess: () => setDeleteTarget(null),
    },
  );

  // 批量导入 — 成功文案带服务端统计
  const bulkMutation = useApiMutation(
    (payload: { words: string[]; severity: "block" | "warn" }) =>
      postJson<{ inserted: number; skipped: number }>("/api/admin/keywords/bulk", payload),
    {
      refresh: false,
      invalidate: [queryKeys.adminKeywords()],
      successToast: (res) => `导入完成：新增 ${res.inserted} 个，跳过重复 ${res.skipped} 个`,
      onSuccess: () => {
        setBulkOpen(false);
        setBulkText("");
      },
    },
  );

  function add() {
    if (!word.trim()) return;
    void addMutation.mutate({
      word: word.trim(),
      severity,
      category: category.trim() || undefined,
    });
  }

  function bulkImport() {
    const words = bulkText
      .split("\n")
      .map((w) => w.trim())
      .filter(Boolean);
    if (!words.length) {
      toast.error("请输入至少一个关键词");
      return;
    }
    void bulkMutation.mutate({ words, severity: bulkSeverity });
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
        <Button onClick={add} disabled={addMutation.pending || !word.trim()}>
          {addMutation.pending ? "添加中…" : "添加"}
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
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkMutation.pending}>
              取消
            </Button>
            <Button onClick={bulkImport} disabled={bulkMutation.pending || !bulkText.trim()}>
              {bulkMutation.pending ? "导入中…" : "导入"}
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
        pending={removeMutation.pending}
        onConfirm={() => {
          if (deleteTarget) void removeMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}
