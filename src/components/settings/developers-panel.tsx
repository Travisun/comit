"use client";

import { useState } from "react";
import { SectionTabs } from "@/components/ui/settings";
import { WebhooksPanel } from "./webhooks-panel";
import { TokensPanel } from "./tokens-panel";
import type { SettingsData } from "./types";

/**
 * 开发设置 — merged settings page (Webhook + API·MCP), Stripe sub-section tabs.
 */
export function DevelopersPanel({
  webhooks,
  tokens,
  appUrl,
  webhookEvents,
  tokenScopes,
}: {
  webhooks: SettingsData["webhooks"];
  tokens: SettingsData["tokens"];
  appUrl: string;
  webhookEvents: string[];
  tokenScopes: string[];
}) {
  const [tab, setTab] = useState<"webhooks" | "tokens">("webhooks");

  return (
    <div className="space-y-6">
      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: "webhooks", label: "Webhook" },
          { id: "tokens", label: "API · MCP" },
        ]}
      />
      {tab === "webhooks" && <WebhooksPanel initial={webhooks} availableEvents={webhookEvents} />}
      {tab === "tokens" && (
        <TokensPanel initial={tokens} appUrl={appUrl} availableScopes={tokenScopes} />
      )}
    </div>
  );
}
