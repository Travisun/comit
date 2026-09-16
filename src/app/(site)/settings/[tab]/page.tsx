import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { ALL_WEBHOOK_EVENT_NAMES } from "@/extensions/webhooks/server";
import { TOKEN_SCOPES } from "@/lib/tokens";
import { getSettingsPageData, isSettingsTab } from "../_data";
import { TimelineHeader } from "@/components/site-shell";
import { getT } from "@/lib/i18n";
import { SettingsPanel } from "@/components/settings/settings-panel";

export const dynamic = "force-dynamic";

/**
 * One settings section per real path (/settings/profile, /settings/security…).
 * Sections are flattened into the dashboard sidebar — no inner nav here.
 */
export default async function SettingsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  // legacy single-item routes → their merged page
  const LEGACY: Record<string, string> = {
    data: "export",
    webhooks: "api",
    tokens: "api",
    developers: "mcp",
    subdomain: "username",
    site: "username",
  };
  if (tab in LEGACY) redirect(`/settings/${LEGACY[tab]}`);
  if (!isSettingsTab(tab)) notFound();

  const auth = await requireUser();
  const { data, enabledTabs } = await getSettingsPageData(auth);
  if (!(enabledTabs as readonly string[]).includes(tab)) redirect(`/settings/${enabledTabs[0]}`);

  const zh = (await getT()).locale === "zh";
  const { SettingsPanel } = await import("@/components/settings/settings-panel");
  const label = { extensions: "扩展", profile: "资料", security: "安全", notifications: "通知", site: "站点", verification: "认证", username: "用户名", privacy: "隐私", email: "邮箱", connections: "账号绑定", invites: "邀请码", mcp: "MCP", api: "API", export: "数据导出", delete: "账户删除", appearance: "外观", subdomain: "子域名", webhooks: "Webhook", tokens: "API · MCP", developers: "MCP" }[tab] ?? tab;

  return (
    <div className="w-full pt-[10px]">
      <TimelineHeader back title={zh ? label : tab} />
      <div className="mx-auto w-full max-w-[600px] pb-10">
        <SettingsPanel
          tab={tab}
          data={data}
          webhookEvents={[...ALL_WEBHOOK_EVENT_NAMES]}
          tokenScopes={[...TOKEN_SCOPES]}
          enabledTabs={enabledTabs as unknown as string[]}
        />
      </div>
    </div>
  );
}
