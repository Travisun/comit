"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isAuthError, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";

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
  const queryClient = useQueryClient();

  // 拉黑状态放查询缓存（组件本地乐观键）：optimistic 先翻转、失败自动回滚。
  const stateKey = useMemo(() => ["block", username] as const, [username]);
  const { data: blocked } = useQuery({
    queryKey: stateKey,
    queryFn: (): boolean => initialBlocked,
    initialData: initialBlocked,
    staleTime: Infinity,
  });

  const toggleMutation = useApiMutation(
    () => postJson<{ blocked: boolean }>("/api/blocks", { username }),
    {
      // 无关系查询键可失效 → 默认 RSC refresh 兜底页面上的服务端关系数据
      optimistic: {
        queryKey: stateKey,
        apply: (prev) => !prev,
      },
      successToast: (r) => (r.blocked ? t("user.blocked") : t("user.unblock")),
      onSuccess: (r) => {
        // 以服务端权威值收敛
        queryClient.setQueryData<boolean>(stateKey, r.blocked);
      },
      onError: (err) => {
        // 失败 toast 由 useApiMutation 默认给出；这里只补登录跳转
        if (isAuthError(err)) router.push("/auth/login");
      },
    },
  );

  function toggle() {
    if (toggleMutation.pending) return;
    void toggleMutation.mutate(undefined);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      disabled={toggleMutation.pending}
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
