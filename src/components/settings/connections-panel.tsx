"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Link2, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { cn } from "@/lib/utils";
import { apiRequest } from "./client";
import { queryKeys } from "@/lib/query/keys";
import { useI18n } from "@/lib/i18n/client";

interface Connection {
  provider: "github" | "google" | "linuxdo";
  label: string;
  desc: string;
  enabled: boolean;
  linked: boolean;
}

const PROVIDER_META: Record<string, { label: string; desc: { zh: string; en: string } }> = {
  github: { label: "GitHub", desc: { zh: "使用 GitHub 账号登录", en: "Sign in with GitHub" } },
  google: { label: "Google", desc: { zh: "使用 Google 账号登录", en: "Sign in with Google" } },
  linuxdo: { label: "Linux.do", desc: { zh: "使用 Linux.do 账号登录（L 站社区账号）", en: "Sign in with your Linux.do account" } },
};

/** 账号绑定 — 把 GitHub / Google 等第三方账号绑定到当前账户，或解除绑定。 */
export function ConnectionsPanel() {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale === "zh";
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const connectionsQ = useQuery({
    queryKey: queryKeys.connections(),
    queryFn: async () =>
      (await apiRequest<{ connections: Connection[] }>("/api/me/connections", "GET")).connections,
  });
  const connections = connectionsQ.data;

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
    if (busy) return;
    if (!window.confirm(zh ? `确定解除 ${provider} 的绑定？解除后需保留其他登录方式。` : `Unlink ${provider}?`)) return;
    setBusy(provider);
    try {
      await apiRequest(`/api/me/connections?provider=${provider}`, "DELETE");
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections() });
      toast.success(zh ? "已解除绑定" : "Unlinked");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
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
            icon={<Link2 className="size-4" />}
            title={
              <span className="flex items-center gap-2">
                {conn.label}
                {conn.linked && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="size-3.5" /> {zh ? "已绑定" : "Linked"}
                  </span>
                )}
              </span>
            }
            description={PROVIDER_META[conn.provider]?.desc?.[zh ? "zh" : "en"] ?? ""}
            control={
              conn.linked ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === conn.provider}
                  onClick={() => void unbind(conn.provider)}
                >
                  {busy === conn.provider ? <Loader2 className="animate-spin" /> : <Unlink />}
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
