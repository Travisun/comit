import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { ALL_WEBHOOK_EVENT_NAMES } from "@/plugins/webhooks";
import { TOKEN_SCOPES } from "@/lib/tokens";
import { getSettingsPageData, isSettingsTab } from "../_data";
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
  if (!isSettingsTab(tab)) notFound();

  const auth = await requireUser();
  const { data, enabledTabs } = await getSettingsPageData(auth);
  if (!(enabledTabs as readonly string[]).includes(tab)) redirect(`/settings/${enabledTabs[0]}`);

  return (
    <SettingsPanel
      tab={tab}
      data={data}
      webhookEvents={[...ALL_WEBHOOK_EVENT_NAMES]}
      tokenScopes={[...TOKEN_SCOPES]}
      enabledTabs={enabledTabs as unknown as string[]}
    />
  );
}
