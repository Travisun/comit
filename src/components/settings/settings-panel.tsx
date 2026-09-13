"use client";

import { useI18n } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/client";
import type { SettingsData, SettingsTab } from "./types";
import { ProfileForm } from "./profile-form";
import { SecurityPanel } from "./security-panel";
import { NotificationsPanel } from "./notifications-panel";
import { SubdomainForm } from "./subdomain-form";
import { InvitesPanel } from "./invites-panel";
import { WebhooksPanel } from "./webhooks-panel";
import { TokensPanel } from "./tokens-panel";
import { DataPanel } from "./data-panel";
import { VerificationPanel } from "./verification-panel";
import { SitePanel } from "./site-panel";
import { DevelopersPanel } from "./developers-panel";

/** Section manifest — rendered as the dashboard sidebar menu. */
export const SETTINGS_SECTION_DEFS: { id: SettingsTab; labelKey: DictKey }[] = [
  { id: "profile", labelKey: "settings.tab.profile" },
  { id: "security", labelKey: "settings.tab.security" },
  { id: "notifications", labelKey: "settings.tab.notifications" },
  { id: "site", labelKey: "settings.tab.site" },
  { id: "verification", labelKey: "settings.tab.verification" },
  { id: "developers", labelKey: "settings.tab.developers" },
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
    case "site":
      return <SitePanel subdomain={data.subdomain} invites={data.invites} appUrl={data.appUrl} />;
    case "verification":
      return <VerificationPanel />;
    case "developers":
      return (
        <DevelopersPanel
          webhooks={data.webhooks}
          tokens={data.tokens}
          appUrl={data.appUrl}
          webhookEvents={webhookEvents}
          tokenScopes={tokenScopes}
        />
      );
    case "data":
      return <DataPanel initial={data.exports} hasPassword={data.security.hasPassword} />;
    default: {
      void enabledTabs;
      return null;
    }
  }
}
