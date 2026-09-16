import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { exportJobs, sessions, totpSecrets, users, webhooks } from "@/db/schema";
import { USERNAME_COOLDOWN_DAYS, USERNAME_MAX, USERNAME_MIN } from "@/lib/users";
import { listApiTokens } from "@/lib/tokens";
import { listInvites, MAX_INVITES_PER_USER } from "@/lib/auth/invite";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { getSetting } from "@/lib/settings";
import { bootPlugins, channels } from "@/core/plugins/registry";
import { config } from "@/core/config";
import type { SettingsTab, SettingsData } from "@/components/settings/types";

/**
 * Settings routes in display order. Single small pages are merged:
 * "site" = 子域名 + 邀请码, "developers" = Webhook + API·MCP.
 */
export const SETTINGS_TABS = [
  "profile",
  "extensions",
  "security",
  "notifications",
  "username",
  "privacy",
  "email",
  "invites",
  "connections",
  "verification",
  "mcp",
  "api",
  "export",
  "delete",
] as const;

export function isSettingsTab(v: string | undefined): v is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(v ?? "");
}

function changesThisYear(at: Date | null): number {
  if (!at) return 0;
  return at.getFullYear() === new Date().getFullYear() ? 1 : 0;
}

/** Server-side assembly of every settings panel's initial data. */
export async function getSettingsPageData(auth: {
  user: {
    id: string;
    displayName: string;
    bio: string;
    github: string | null;
    orcid: string | null;
    website: string | null;
    locale: string;
    username: string;
    usernameUpdatedAt: Date | null;
    customFields: Record<string, string> | null;
    extSettings: Record<string, Record<string, unknown>> | null;
    avatarPath: string | null;
    coverPath: string | null;
    followersVisibility: string;
    followingVisibility: string;
    bookmarksVisibility: string;
    appearance: unknown;
    widgets: string[];
    notificationPrefs: Record<string, string[]> | null;
    subdomain: string | null;
    subdomainUpdatedAt: Date | null;
    passwordHash: string | null;
  };
  sessionId: string;
}): Promise<{ data: SettingsData; enabledTabs: SettingsTab[] }> {
  const u = auth.user;

  // notifications channels are registered by plugins at boot; make sure the
  // registry is populated even if instrumentation has not run yet
  if (channels.size === 0) await bootPlugins();

  const [subEnabled, subLocked, twoFactorConfirmed] = await Promise.all([
    Promise.resolve(false),
    Promise.resolve(false),
    hasConfirmedTotp(u.id),
  ]);

  const [totp] = await db
    .select({ recoveryCodes: totpSecrets.recoveryCodes })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, u.id))
    .limit(1);

  const [sessionRows, inviteRows, webhookRows, tokenRows, exportRows] = await Promise.all([
    db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, u.id))
      .orderBy(desc(sessions.createdAt)),
    listInvites(u.id),
    db.select().from(webhooks).where(eq(webhooks.userId, u.id)).orderBy(desc(webhooks.createdAt)),
    listApiTokens(u.id),
    db
      .select({
        id: exportJobs.id,
        status: exportJobs.status,
        sizeBytes: exportJobs.sizeBytes,
        error: exportJobs.error,
        createdAt: exportJobs.createdAt,
        finishedAt: exportJobs.finishedAt,
      })
      .from(exportJobs)
      .where(eq(exportJobs.userId, u.id))
      .orderBy(desc(exportJobs.createdAt))
      .limit(10),
  ]);

  const usedByNames = new Map<string, string>();
  const usedByIds = inviteRows.map((r) => r.usedBy).filter((v): v is string => Boolean(v));
  if (usedByIds.length) {
    const rows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, usedByIds));
    for (const r of rows) usedByNames.set(r.id, r.username);
  }

  const data: SettingsData = {
    appUrl: config.app.url,
    profile: {
      displayName: u.displayName,
      bio: u.bio,
      github: u.github,
      orcid: u.orcid,
      website: u.website,
      locale: u.locale === "en" ? "en" : "zh",
      avatarPath: u.avatarPath,
      coverPath: u.coverPath,
      followersVisibility: u.followersVisibility as "public" | "followers" | "friends" | "private",
      followingVisibility: u.followingVisibility as "public" | "followers" | "friends" | "private",
      bookmarksVisibility: u.bookmarksVisibility as "public" | "followers" | "friends" | "private",
    },
    appearance: (u.appearance ?? {}) as SettingsData["appearance"],
    widgets: u.widgets ?? [],
    extSettings: (u.extSettings ?? {}) as SettingsData["extSettings"],
    customFields: (u.customFields ?? {}) as SettingsData["customFields"],
    security: {
      twoFactorConfirmed,
      recoveryCodesCount: totp?.recoveryCodes.length ?? 0,
      hasPassword: Boolean(u.passwordHash),
      sessions: sessionRows
        .filter((s) => s.expiresAt > new Date())
        .map((s) => ({
          id: s.id,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          current: s.id === auth.sessionId,
        })),
    },
    notifications: {
      channels: [...channels.values()].map((c) => ({ id: c.id, label: c.label })),
      prefs: u.notificationPrefs ?? {},
    },
    username: (() => {
      const changed = u.usernameUpdatedAt;
      const days = changed ? (Date.now() - changed.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
      return {
        username: u.username,
        min: USERNAME_MIN,
        max: USERNAME_MAX,
        cooldownDays: USERNAME_COOLDOWN_DAYS,
        daysUntilChangeAllowed: Number.isFinite(days)
          ? Math.max(0, Math.ceil(USERNAME_COOLDOWN_DAYS - days))
          : 0,
      };
    })(),
    invites: {
      codes: inviteRows.map((r) => ({
        code: r.code,
        createdAt: r.createdAt.toISOString(),
        usedAt: r.usedAt ? r.usedAt.toISOString() : null,
        usedByUsername: r.usedBy ? usedByNames.get(r.usedBy) ?? null : null,
      })),
      remaining: Math.max(0, MAX_INVITES_PER_USER - inviteRows.filter((r) => !r.usedBy).length),
      max: MAX_INVITES_PER_USER,
    },
    webhooks: webhookRows.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      active: w.active,
      lastStatus: w.lastStatus,
      lastDeliveryAt: w.lastDeliveryAt ? w.lastDeliveryAt.toISOString() : null,
      failCount: w.failCount,
      secretPrefix: w.secret.slice(0, 8),
      createdAt: w.createdAt.toISOString(),
    })),
    tokens: tokenRows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
      revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
    })),
    exports: exportRows.map((e) => ({
      id: e.id,
      status: e.status,
      sizeBytes: e.sizeBytes,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
      finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
    })),
  };

  return { data, enabledTabs: [...SETTINGS_TABS] };
}
