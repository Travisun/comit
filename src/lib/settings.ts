import { cache } from "react";
import { db } from "@/db";
import { settings } from "@/db/schema";

/**
 * Site settings repository (DB-backed, admin-tunable) with defaults and a
 * per-process cache. Keys are dot-namespaced; values are JSON.
 */
export const SETTINGS_DEFAULTS = {
  "site.name": "comit.sh",
  "site.tagline": "Commit your ideas. — 为极客、设计师与科学家打造的个人品牌社区",
  "site.description": "comit.sh — 记录科研日志、技术学习、研究发布与项目动态的个人品牌社交网络。",
  /** multi-user community mode vs single-user personal blog mode */
  "site.mode": "multi" as "multi" | "single",
  /** single-user mode: the username whose blog IS the site */
  "site.singleUser": "" as string,
  "site.subdomains": false,
  "site.subdomainLocked": true, // subdomain can only be set once
  "site.registrationOpen": true,
  "site.inviteRequired": false,
  "site.force2fa": true,
  "site.maintenance": false as boolean,
  "sso.github": false,
  "sso.google": false,
  "sso.x": false,
  "sso.discourse": false,
  "sso.cfaccess": false,
  "sso.linuxdo": false,
  "moderation.reviewMode": "off" as "off" | "llm" | "manual",
  "moderation.keywordsEnabled": true,
  "moderation.llmFailMode": "open" as "open" | "closed",
  /**
   * LLM 多提供商配置（lib/llm.ts v2）：providers 各自带协议/端点/密钥/
   * 型号目录；default 为平台默认模型。admin 设置页维护。
   */
  "llm.providers": { providers: [], default: null } as {
    providers: {
      id: string;
      label: string;
      protocol: "openai" | "anthropic";
      baseUrl: string;
      apiKey: string;
      models: string[];
      temperature?: number;
      thinking?: "off" | "low" | "medium" | "high";
      enabled: boolean;
    }[];
    default: { providerId: string; model: string } | null;
  },
  "moderation.llm": {
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0,
    prompt:
      "你是社区内容审核助手。请判断以下内容是否适合发布到技术与设计博客平台。" +
      "考虑：违法违规、色情低俗、仇恨歧视、暴恐、隐私侵犯、垃圾营销。" +
      "只返回 JSON：{\"approved\": true/false, \"score\": 0-100, \"reason\": \"简短中文理由\"}",
  },
  "notify.emailEnabled": true,
  /**
   * 限流桶覆写（见 @/lib/rate-limit/buckets 的 RATE_BUCKETS）：键为桶名
   * （BucketName），未列出的桶用代码内默认值；admin 路由对该键做精确校验
   */
  "ratelimit.buckets": {} as Partial<Record<string, { limit: number; windowSec: number }>>,
} as const;

export type SettingsKey = keyof typeof SETTINGS_DEFAULTS;

type SettingsMap = Record<string, unknown>;

const g = globalThis as unknown as { __mbSettings?: { data: SettingsMap; at: number } };
const TTL = 10_000;

export const getSettings = cache(async (): Promise<SettingsMap> => {
  if (g.__mbSettings && Date.now() - g.__mbSettings.at < TTL) return g.__mbSettings.data;
  const rows = await db.select().from(settings);
  const data: SettingsMap = { ...SETTINGS_DEFAULTS };
  for (const row of rows) data[row.key] = row.value;
  g.__mbSettings = { data, at: Date.now() };
  return data;
});

export async function getSetting<K extends SettingsKey>(key: K): Promise<(typeof SETTINGS_DEFAULTS)[K]> {
  const all = await getSettings();
  return (all[key] ?? SETTINGS_DEFAULTS[key]) as (typeof SETTINGS_DEFAULTS)[K];
}

export async function setSetting<K extends SettingsKey>(key: K, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  g.__mbSettings = undefined;
}

export async function setSettings(entries: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) await setSetting(key as SettingsKey, value);
}

/** typed helpers */
export const isMultiUserMode = async () => (await getSetting("site.mode")) === "multi";
export const subdomainsEnabled = async () => Boolean(await getSetting("site.subdomains"));
