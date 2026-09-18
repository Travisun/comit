"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Loader2, Unlink } from "lucide-react";
import { ProviderIcon } from "@/components/brand/provider-icon";
import { Button } from "@/components/ui/button";
import {
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useApiMutation } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { apiRequest } from "./client";
import { useI18n } from "@/lib/i18n/client";

/**
 * 服务端 /api/me/connections 只返回 provider/enabled/linked —— 展示文案
 * （label/desc）是纯 i18n 展示层信息，统一由本文件的 PROVIDER_META 提供，
 * 响应模型在边界用 zod 收敛（apiQueryOptions）。
 */
const connectionSchema = z.object({
  provider: z.enum(["github", "google", "linuxdo"]),
  enabled: z.boolean(),
  linked: z.boolean(),
});

const connectionsResponseSchema = z.object({
  connections: z.array(connectionSchema),
});

type Connection = z.infer<typeof connectionSchema>;

const PROVIDER_META: Record<Connection["provider"], { label: string; desc: { zh: string; en: string } }> = {
  github: { label: "GitHub", desc: { zh: "使用 GitHub 账号登录", en: "Sign in with GitHub" } },
  google: { label: "Google", desc: { zh: "使用 Google 账号登录", en: "Sign in with Google" } },
  linuxdo: { label: "Linux.do", desc: { zh: "使用 Linux.do 账号登录（L 站社区账号）", en: "Sign in with your Linux.do account" } },
};

/** 账号绑定 — 把 GitHub / Google 等第三方账号绑定到当前账户，或解除绑定。 */
export function ConnectionsPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const connectionsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.connections(),
      url: "/api/me/connections",
      schema: connectionsResponseSchema,
    }),
  );
  const connections = connectionsQ.data?.connections;

  // 解绑 — pending 驱动禁用态；busyProvider 仅用于定位是哪一行在转圈
  const unbindMutation = useApiMutation(
    (provider: string) => apiRequest(`/api/me/connections?provider=${provider}`, "DELETE"),
    {
      // 保持原行为等价：只失效连接列表查询，不整页 refresh
      refresh: false,
      invalidate: [queryKeys.connections()],
      successToast: zh ? "已解除绑定" : "Unlinked",
    },
  );
  const unbinding = unbindMutation.pending ? busyProvider : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("linked");
    if (linked) toast.success(zh ? `已绑定 ${linked}` : `Linked ${linked}`);
    if (params.get("error") === "taken")
      toast.error(zh ? "该第三方账号已绑定到其他账户" : "Already linked to another account");
    if (params.get("error") === "session")
      toast.error(zh ? "会话已过期，请重新登录后绑定" : "Session expired — sign in again");
  }, [zh]);

  async function unbind(provider: string) {
    if (unbindMutation.pending) return;
    if (!window.confirm(zh ? `确定解除 ${provider} 的绑定？解除后需保留其他登录方式。` : `Unlink ${provider}?`)) return;
    setBusyProvider(provider);
    await unbindMutation.mutate(provider);
  }

  if (!connections) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        description={
          zh
            ? "绑定第三方账号后，可以使用对应方式登录。绑定跳转到第三方授权页完成。"
            : "Link third-party accounts to sign in with them. Linking opens the provider's authorization page."
        }
      />
      <SettingsPanelList>
        {connections.map((conn) => (
          <SettingsPanelRow
            key={conn.provider}
            icon={<ProviderIcon provider={conn.provider} />}
            title={
              <span className="flex items-center gap-2">
                {PROVIDER_META[conn.provider].label}
                {conn.linked && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="size-3.5" /> {zh ? "已绑定" : "Linked"}
                  </span>
                )}
              </span>
            }
            description={PROVIDER_META[conn.provider].desc[zh ? "zh" : "en"]}
            control={
              conn.linked ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unbinding === conn.provider}
                  onClick={() => void unbind(conn.provider)}
                >
                  {unbinding === conn.provider ? <Loader2 className="animate-spin" /> : <Unlink />}
                  {zh ? "解除绑定" : "Unlink"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!conn.enabled}
                  title={conn.enabled ? undefined : zh ? "站点未启用该登录方式" : "Provider not enabled"}
                  asChild
                >
                  <a href={`/api/auth/oauth/${conn.provider}?link=1`}>
                    {conn.enabled ? (zh ? "绑定" : "Link") : zh ? "未启用" : "Not available"}
                  </a>
                </Button>
              )
            }
          />
        ))}
      </SettingsPanelList>
    </SettingsSection>
  );
}
