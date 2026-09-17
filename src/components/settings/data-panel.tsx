"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Checkbox } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { formatBytes, timeAgo } from "@/lib/utils";
import { apiRequest } from "./client";
import type { ExportJobView } from "./types";

function statusBadge(status: string, locale: "zh" | "en") {
  const labels: Record<string, { zh: string; en: string }> = {
    queued: { zh: "排队中", en: "Queued" },
    building: { zh: "打包中", en: "Building" },
    done: { zh: "已完成", en: "Done" },
    failed: { zh: "失败", en: "Failed" },
  };
  const l = labels[status] ?? { zh: status, en: status };
  const variant =
    status === "done" ? "success" : status === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant}>{locale === "zh" ? l.zh : l.en}</Badge>;
}

function ExportCard({ initial }: { initial: ExportJobView[] }) {
  const { t, locale } = useI18n();

  // 任务列表 — 有 queued/building 任务时每 3s 轮询，全部收尾后停表
  // （refetchInterval 以最新 data 判定；后台标签页不轮询）
  const jobsQ = useQuery({
    queryKey: queryKeys.exportJobs(),
    queryFn: async () => (await apiRequest<{ jobs: ExportJobView[] }>("/api/export", "GET")).jobs,
    // 服务端首屏任务作为初始缓存，挂载不空转
    initialData: initial,
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === "queued" || j.status === "building") ? 3000 : false,
    refetchIntervalInBackground: false,
  });
  const jobs = jobsQ.data ?? initial;
  const hasPending = jobs.some((j) => j.status === "queued" || j.status === "building");

  // 创建导出任务 — 成功后失效任务列表键，轮询由上面的 refetchInterval 自然接管
  const startMutation = useApiMutation(() => apiRequest("/api/export", "POST", {}), {
    refresh: false,
    invalidate: [queryKeys.exportJobs()],
    successToast: locale === "zh" ? "导出任务已创建" : "Export job created",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <p className="text-sm text-muted-foreground">{t("settings.data.exportDesc")}</p>
        <Button
          size="sm"
          onClick={() => void startMutation.mutate(undefined)}
          disabled={startMutation.pending || hasPending}
        >
          {startMutation.pending || hasPending ? <Loader2 className="animate-spin" /> : <FileDown />}
          {t("settings.data.exportStart")}
        </Button>
      </div>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {locale === "zh" ? "还没有导出记录" : "No exports yet"}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {statusBadge(j.status, locale)}
                    {j.status === "done" && j.sizeBytes != null && (
                      <span className="text-muted-foreground">{formatBytes(j.sizeBytes)}</span>
                    )}
                    {j.status === "failed" && j.error && (
                      <span className="max-w-64 truncate text-xs text-destructive">{j.error}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(j.createdAt, locale)}
                    {j.finishedAt && ` · ${locale === "zh" ? "完成于" : "finished"} ${timeAgo(j.finishedAt, locale)}`}
                  </p>
                </div>
                {j.status === "done" && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/export/${j.id}/download`}>
                      <Download />
                      {t("settings.data.exportReady")}
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
  );
}

function DangerZone({ hasPassword }: { hasPassword: boolean }) {
  const { t, locale } = useI18n();
  const [password, setPassword] = useState("");
  const [deleteContent, setDeleteContent] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const confirmWord = locale === "zh" ? "删除" : "DELETE";

  // 注销账户 — pending 驱动确认按钮禁用；成功 toast 后整页跳转（见 onSuccess）
  const destroyMutation = useApiMutation(
    (input: { password?: string; deleteContent: boolean }) => apiRequest("/api/me", "DELETE", input),
    {
      // 会话已销毁，RSC 回流无意义；跳转由 onSuccess 接管
      refresh: false,
      successToast: locale === "zh" ? "账户已删除" : "Account deleted",
      onSuccess: () => {
        // 整页跳转：会话已销毁，避免 push+refresh 双 RSC 竞态并清空全部客户端缓存
        window.location.replace("/");
      },
    },
  );

  function destroy() {
    if (destroyMutation.pending) return;
    void destroyMutation.mutate({
      password: hasPassword && password ? password : undefined,
      deleteContent,
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_4%,transparent)] p-5">
      <p className="mb-4 flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="size-4" />
        {t("settings.data.deleteDesc")}
      </p>
      <div className="space-y-4">
        {hasPassword && (
          <div className="grid max-w-md gap-2">
            <Label htmlFor="delPw">{t("auth.password")}</Label>
            <Input
              id="delPw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("settings.data.deleteConfirm")}
            />
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={deleteContent}
            onCheckedChange={(v) => setDeleteContent(v === true)}
          />
          {locale === "zh"
            ? "同时删除我的所有内容（否则内容将匿名化保留）"
            : "Also delete all my content (otherwise content is anonymized)"}
        </label>
        <Button
          variant="destructive"
          disabled={hasPassword && password.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          {t("settings.data.delete")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("settings.data.delete")}</DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? deleteContent
                  ? "账户与全部内容将被永久删除，不可恢复。"
                  : "账户将注销，内容以「已注销用户」匿名保留。"
                : deleteContent
                  ? "Your account and all content will be permanently deleted."
                  : "Your account will be anonymized; content stays."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirmDelete">
              {locale === "zh" ? `输入「${confirmWord}」以确认` : `Type "${confirmWord}" to confirm`}
            </Label>
            <Input
              id="confirmDelete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmWord}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText.trim() !== confirmWord || destroyMutation.pending}
              onClick={destroy}
            >
              {destroyMutation.pending && <Loader2 className="animate-spin" />}
              {t("settings.data.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExportPanel({ initial }: { initial: ExportJobView[] }) {
  return <ExportCard initial={initial} />;
}

export function DeleteAccountPanel({ hasPassword }: { hasPassword: boolean }) {
  return <DangerZone hasPassword={hasPassword} />;
}
