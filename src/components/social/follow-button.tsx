"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isAuthError, postJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import { openLoginDialog } from "@/lib/store/login-dialog";

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
  const queryClient = useQueryClient();

  // 关注状态放查询缓存（组件本地乐观键）：optimistic 先翻转、失败自动回滚。
  const stateKey = useMemo(() => ["follow", username] as const, [username]);
  const { data: following } = useQuery({
    queryKey: stateKey,
    queryFn: (): boolean => initialFollowing,
    initialData: initialFollowing,
    staleTime: Infinity,
  });

  const toggleMutation = useApiMutation(
    () => postJson<{ following: boolean }>("/api/follows", { username }),
    {
      // 无 ["relation", username] 之类的关系查询键 → 默认 RSC refresh 兜底
      optimistic: {
        queryKey: stateKey,
        apply: (prev) => !prev,
      },
      onSuccess: (r) => {
        // 以服务端权威值收敛（与乐观值通常一致）
        queryClient.setQueryData<boolean>(stateKey, r.following);
      },
      onError: (err) => {
        // 失败 toast 由 useApiMutation 默认给出；游客 → 唤起登录引导
        if (isAuthError(err)) openLoginDialog();
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
      variant={following ? "outline" : "default"}
      size="sm"
      onClick={toggle}
      disabled={toggleMutation.pending}
      className={cn("min-h-9", className)}
    >
      {following ? <UserCheck /> : <UserPlus />}
      {following ? t("post.unfollow") : t("post.follow")}
    </Button>
  );
}
