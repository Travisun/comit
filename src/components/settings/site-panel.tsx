"use client";

import { UsernameForm } from "./username-form";
import { InvitesPanel } from "./invites-panel";
import type { SettingsData } from "./types";

/**
 * 站点 — 用户名（主页地址）+ 邀请码。两个独立区块纵向堆叠，
 * 不再使用内部 tabs。
 */
export function SitePanel({
  username,
  invites,
  appUrl,
}: {
  username: SettingsData["username"];
  invites: SettingsData["invites"];
  appUrl: string;
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-medium text-foreground">
          用户名
        </h2>
        <UsernameForm data={username} />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-medium text-foreground">邀请码</h2>
        <InvitesPanel data={invites} appUrl={appUrl} />
      </section>
    </div>
  );
}
