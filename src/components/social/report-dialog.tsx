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
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/client/api";

/** 常用举报原因（单选）；「其他」时需填写自定义说明。 */
export const REPORT_REASONS = [
  "垃圾广告或引流",
  "违法违规内容",
  "人身攻击或骚扰",
  "色情低俗内容",
  "抄袭或侵权",
  "虚假不实信息",
  "其他问题",
] as const;

export function ReportDialog({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment" | "user";
  targetId: string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!preset || busy) return;
    const extra = detail.trim();
    const text = preset === "其他问题" ? extra : extra ? `${preset} — ${extra}` : preset;
    if (!text) return;
    setBusy(true);
    try {
      await postJson("/api/reports", { targetType, targetId, reason: text });
      toast.success(t("post.reported"));
      setOpen(false);
      setPreset(null);
      setDetail("");
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
        <div className="grid gap-1.5" role="radiogroup" aria-label={locale === "zh" ? "举报原因" : "Report reason"}>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                preset === r
                  ? "border-primary/50 bg-[var(--muted)] text-foreground"
                  : "border-border text-muted-foreground hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              <input
                type="radio"
                name="report-reason"
                className="size-3.5 accent-[var(--primary)]"
                checked={preset === r}
                onChange={() => setPreset(r)}
              />
              {r}
            </label>
          ))}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="report-detail">
            {locale === "zh" ? "补充说明" : "Details"}
            <span className="font-normal text-muted-foreground">
              {preset === "其他问题"
                ? locale === "zh"
                  ? "（必填，请描述具体问题）"
                  : " (required)"
                : locale === "zh"
                  ? "（选填）"
                  : " (optional)"}
            </span>
          </Label>
          <Textarea
            id="report-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={locale === "zh" ? "补充细节，帮助管理员更快处理…" : "Add details to help moderators…"}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancelAction")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !preset || (preset === "其他问题" && !detail.trim())}
          >
            {t("post.report")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
