"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Download, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionTabs } from "@/components/ui/settings";
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
  const [jobs, setJobs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = jobs.some((j) => j.status === "queued" || j.status === "building");

  useEffect(() => {
    if (!hasPending) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiRequest<{ jobs: ExportJobView[] }>("/api/export", "GET");
        setJobs(res.jobs);
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasPending]);

  async function start() {
    setBusy(true);
    try {
      await apiRequest("/api/export", "POST", {});
      const res = await apiRequest<{ jobs: ExportJobView[] }>("/api/export", "GET");
      setJobs(res.jobs);
      toast.success(locale === "zh" ? "导出任务已创建" : "Export job created");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <p className="text-sm text-muted-foreground">{t("settings.data.exportDesc")}</p>
        <Button size="sm" onClick={start} disabled={busy || hasPending}>
          {busy || hasPending ? <Loader2 className="animate-spin" /> : <FileDown />}
          {t("settings.data.exportStart")}
        </Button>
      </div>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {locale === "zh" ? "还没有导出记录" : "No exports yet"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
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
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [deleteContent, setDeleteContent] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmWord = locale === "zh" ? "删除" : "DELETE";

  async function destroy() {
    setBusy(true);
    try {
      await apiRequest("/api/me", "DELETE", {
        password: hasPassword && password ? password : undefined,
        deleteContent,
      });
      toast.success(locale === "zh" ? "账户已删除" : "Account deleted");
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
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
              disabled={confirmText.trim() !== confirmWord || busy}
              onClick={destroy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {t("settings.data.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DataPanel({
  initial,
  hasPassword,
}: {
  initial: ExportJobView[];
  hasPassword: boolean;
}) {
  const [tab, setTab] = useState<"export" | "danger">("export");
  const { locale } = useI18n();

  return (
    <div className="space-y-6">
      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as "export" | "danger")}
        tabs={[
          { id: "export", label: locale === "zh" ? "数据导出" : "Export" },
          { id: "danger", label: locale === "zh" ? "危险操作" : "Danger zone" },
        ]}
      />
      {tab === "export" && <ExportCard initial={initial} />}
      {tab === "danger" && <DangerZone hasPassword={hasPassword} />}
    </div>
  );
}
