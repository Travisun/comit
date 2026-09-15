"use client";

import { useI18n } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/client";
import type { SettingsData, SettingsTab } from "./types";
import { ProfileForm } from "./profile-form";
import { SecurityPanel } from "./security-panel";
import { NotificationsPanel } from "./notifications-panel";
import { InvitesPanel } from "./invites-panel";
import { WebhooksPanel } from "./webhooks-panel";
import { McpPanel, ApiTokensPanel } from "./tokens-panel";
import { DataPanel } from "./data-panel";
import { VerificationPanel } from "./verification-panel";
import { UsernameForm } from "./username-form";

/** Section manifest — rendered as the dashboard sidebar menu. */
export const SETTINGS_SECTION_DEFS: { id: SettingsTab; labelKey: DictKey }[] = [
  { id: "profile", labelKey: "settings.tab.profile" },
  { id: "security", labelKey: "settings.tab.security" },
  { id: "notifications", labelKey: "settings.tab.notifications" },
  { id: "username", labelKey: "settings.tab.username" },
  { id: "invites", labelKey: "settings.tab.invites" },
  { id: "verification", labelKey: "settings.tab.verification" },
  { id: "mcp", labelKey: "settings.tab.mcp" },
  { id: "api", labelKey: "settings.tab.api" },
  { id: "data", labelKey: "settings.tab.data" },
];

/**
 * Renders ONE settings section as a standalone page. Navigation follows the
 * Stripe settings pattern: a segmented radio-style tab strip (36px track,
 * active segment = white + keyline) above the section content.
 */
export function SettingsPanel({
  tab,
  data,
  webhookEvents,
  tokenScopes,
  enabledTabs,
}: {
  tab: SettingsTab;
  data: SettingsData;
  webhookEvents: string[];
  tokenScopes: string[];
  enabledTabs?: string[];
}) {
  const { t } = useI18n();
  const def = SETTINGS_SECTION_DEFS.find((s) => s.id === tab);

  return (
    <div className="mx-auto w-full max-w-[600px] px-4 pt-4">
      {def && tab !== "profile" ? null : null}

      <div className="animate-[slide-up_0.3s_cubic-bezier(0.16,1,0.3,1)_both]">
        {section(tab, data, webhookEvents, tokenScopes, enabledTabs)}
      </div>
    </div>
  );
}

function section(
  tab: SettingsTab,
  data: SettingsData,
  webhookEvents: string[],
  tokenScopes: string[],
  enabledTabs?: string[],
) {
  switch (tab) {
    case "profile":
      return <ProfileForm initial={data.profile} />;
    case "security":
      return <SecurityPanel data={data.security} />;
    case "notifications":
      return <NotificationsPanel channels={data.notifications.channels} initialPrefs={data.notifications.prefs} />;
    case "username":
      return <UsernameForm data={data.username} />;
    case "invites":
      return <InvitesPanel data={data.invites} appUrl={data.appUrl} />;
    case "verification":
      return <VerificationPanel />;
    case "mcp":
      return <McpPanel appUrl={data.appUrl} />;
    case "api":
      return (
        <div className="space-y-8">
          <ApiTokensPanel initial={data.tokens} availableScopes={tokenScopes} />
          <WebhooksPanel initial={data.webhooks} availableEvents={webhookEvents} />
        </div>
      );
    case "data":
      return <DataPanel initial={data.exports} hasPassword={data.security.hasPassword} />;
    default: {
      void enabledTabs;
      return null;
    }
  }
}
