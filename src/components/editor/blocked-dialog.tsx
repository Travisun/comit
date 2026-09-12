"use client";

import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";

/** Shown when the server's pre-submit keyword check returns 422 { blocked }. */
export function BlockedDialog({
  blocked,
  onClose,
}: {
  blocked: string[] | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={blocked !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>无法发布 / Unable to publish</DialogTitle>
          <DialogDescription>
            内容包含被禁止的关键词，请修改相关内容后重试 / The content contains blocked
            keywords, please revise and try again:
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {(blocked ?? []).map((word) => (
            <Badge key={word} variant="destructive">
              {word}
            </Badge>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
