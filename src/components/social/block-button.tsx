"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isAuthError, postJson } from "@/lib/client/api";

export function BlockButton({
  username,
  initialBlocked,
  className,
}: {
  username: string;
  initialBlocked: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson<{ blocked: boolean }>("/api/blocks", { username });
      setBlocked(r.blocked);
      toast.success(r.blocked ? t("user.blocked") : t("user.unblock"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      if (isAuthError(err)) {
        router.push("/auth/login");
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      disabled={busy}
      className={cn(
        "text-muted-foreground",
        blocked && "text-destructive hover:text-destructive",
        className,
      )}
    >
      {blocked ? <ShieldCheck /> : <Ban />}
      {blocked ? t("user.unblock") : t("user.block")}
    </Button>
  );
}
