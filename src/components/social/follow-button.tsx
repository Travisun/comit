"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isAuthError, postJson } from "@/lib/client/api";

export function FollowButton({
  username,
  initialFollowing,
  className,
}: {
  username: string;
  initialFollowing: boolean;
  /** optional extra styling (contract superset) */
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson<{ following: boolean }>("/api/follows", { username });
      setFollowing(r.following);
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
      variant={following ? "outline" : "default"}
      size="sm"
      onClick={toggle}
      disabled={busy}
      className={cn("min-h-9", className)}
    >
      {following ? <UserCheck /> : <UserPlus />}
      {following ? t("post.unfollow") : t("post.follow")}
    </Button>
  );
}
