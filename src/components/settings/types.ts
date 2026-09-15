import type { LocalizedText } from "@/core/plugins/types";

/**
 * Shared, serializable types + constants for the settings UI.
 * Imported by both server routes and client components — keep it pure.
 */

export type SettingsTab =
  | "profile"
  | "appearance"
  | "security"
  | "notifications"
  | "username"
  | "privacy"
  | "email"
  | "connections"
  | "invites"
  | "verification"
  | "mcp"
  | "api"
  | "developers"
  | "export"
  | "delete"
  // legacy single-item routes (redirect to their merged page)
  | "subdomain"
  | "invites"
  | "webhooks"
  | "tokens";

export interface NotificationEventDef {
  key: string;
  label: LocalizedText;
}

/** Fixed list of user-tunable notification events. */
export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  { key: "comment.created", label: { zh: "评论与回复", en: "Comments & replies" } },
  { key: "follow.new", label: { zh: "新关注", en: "New followers" } },
  { key: "message.new", label: { zh: "新私信", en: "New messages" } },
  { key: "like.post", label: { zh: "文章获赞", en: "Post likes" } },
  { key: "moderation.rejected", label: { zh: "内容未通过审核", en: "Moderation rejections" } },
];

export interface ChannelOption {
  id: string;
  label: LocalizedText;
}

export interface SessionView {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface InviteView {
  code: string;
  createdAt: string;
  usedAt: string | null;
  usedByUsername: string | null;
}

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  failCount: number;
  secretPrefix: string;
  createdAt: string;
}

export interface TokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ExportJobView {
  id: string;
  status: string;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AppearanceValue {
  homeBg?: string | null;
  postBg?: string | null;
  accent?: string | null;
  fontFamily?: "system" | "serif" | "mono" | null;
  fontSize?: "sm" | "md" | "lg" | null;
}

/** Everything the settings page renders, loaded server-side. */
export interface SettingsData {
  appUrl: string;
  profile: {
    displayName: string;
    bio: string;
    github: string | null;
    orcid: string | null;
    website: string | null;
    locale: "zh" | "en";
    avatarPath: string | null;
    coverPath: string | null;
    hideFollowers: boolean;
    hideFollowing: boolean;
  };
  appearance: AppearanceValue;
  widgets: string[];
  security: {
    twoFactorConfirmed: boolean;
    recoveryCodesCount: number;
    hasPassword: boolean;
    sessions: SessionView[];
  };
  notifications: {
    channels: ChannelOption[];
    prefs: Record<string, string[]>;
  };
  username: {
    username: string;
    min: number;
    max: number;
    cooldownDays: number;
    daysUntilChangeAllowed: number;
  };
  invites: {
    codes: InviteView[];
    remaining: number;
    max: number;
  };
  webhooks: WebhookView[];
  tokens: TokenView[];
  exports: ExportJobView[];
}
