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

/** Section manifest — the dashboard sidebar renders these as top-level items. */
export const SETTINGS_SECTION_DEFS: { id: SettingsTab; labelKey: DictKey }[] = [
  { id: "profile", labelKey: "settings.tab.profile" },
  { id: "appearance", labelKey: "settings.tab.appearance" },
  { id: "security", labelKey: "settings.tab.security" },
  { id: "notifications", labelKey: "settings.tab.notifications" },
  { id: "subdomain", labelKey: "settings.tab.subdomain" },
  { id: "invites", labelKey: "settings.tab.invites" },
  { id: "verification", labelKey: "settings.tab.verification" },
  { id: "webhooks", labelKey: "settings.tab.webhooks" },
  { id: "tokens", labelKey: "settings.tab.tokens" },
  { id: "data", labelKey: "settings.tab.data" },
];

/**
 * Renders ONE settings section as a standalone page. Navigation between
 * sections lives in the dashboard sidebar (flattened — no inner nav).
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
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">{t(def?.labelKey ?? "settings.tab.profile")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.title")}</p>
      </header>

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
    case "subdomain":
      return <SubdomainForm data={data.subdomain} />;
    case "invites":
      return <InvitesPanel data={data.invites} appUrl={data.appUrl} />;
    case "verification":
      return <VerificationPanel />;
    case "webhooks":
      return <WebhooksPanel initial={data.webhooks} availableEvents={webhookEvents} />;
    case "tokens":
      return <TokensPanel initial={data.tokens} appUrl={data.appUrl} availableScopes={tokenScopes} />;
    case "data":
      return <DataPanel initial={data.exports} hasPassword={data.security.hasPassword} />;
    default: {
      void enabledTabs;
      return null;
    }
  }
}
