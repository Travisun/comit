"use client";

import { useState } from "react";
import { SectionTabs } from "@/components/ui/settings";
import { SubdomainForm } from "./subdomain-form";
import { InvitesPanel } from "./invites-panel";
import type { SettingsData } from "./types";

/**
 * 站点 — merged settings page (子域名 + 邀请码), Stripe sub-section tabs.
 * The 子域名 tab is hidden when the site-wide subdomain feature is off.
 */
export function SitePanel({
  subdomain,
  invites,
  appUrl,
}: {
  subdomain: SettingsData["subdomain"];
  invites: SettingsData["invites"];
  appUrl: string;
}) {
  const [tab, setTab] = useState<"subdomain" | "invites">(
    subdomain.enabled ? "subdomain" : "invites",
  );

  return (
    <div className="space-y-6">
      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          ...(subdomain.enabled ? [{ id: "subdomain", label: "子域名" }] : []),
          { id: "invites", label: "邀请码" },
        ]}
      />
      {tab === "subdomain" && subdomain.enabled && <SubdomainForm data={subdomain} />}
      {tab === "invites" && <InvitesPanel data={invites} appUrl={appUrl} />}
    </div>
  );
}
