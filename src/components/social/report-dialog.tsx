"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { postJson } from "./api";

export function ReportDialog({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment" | "user";
  targetId: string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = reason.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await postJson("/api/reports", { targetType, targetId, reason: text });
      toast.success(t("post.reported"));
      setOpen(false);
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9 text-muted-foreground hover:text-destructive"
        >
          <Flag />
          {t("post.report")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("post.report")}</DialogTitle>
          <DialogDescription>
            {locale === "zh"
              ? "请描述举报原因，管理员会尽快处理。"
              : "Describe why you are reporting this; moderators will review it."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="report-reason">{t("common.required")}</Label>
          <Textarea
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder={t("comments.placeholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !reason.trim()}>
            {t("post.report")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
