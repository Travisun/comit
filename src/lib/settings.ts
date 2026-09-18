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
  /** SEO 关键词（逗号/中文逗号分隔），进 <meta name=keywords> 与根 OG 页 */
  "site.keywords": "" as string,
  /** 默认分享图（OG / twitter:card 大图）：站内媒体相对路径或完整 https URL */
  "site.ogImage": "" as string,
  /** twitter:site 句柄（@xxx），空则不下发 */
  "site.twitter": "" as string,
  /** 页脚版权行：留空用默认 `© {年份} {site.name}` */
  "site.copyright": "" as string,
  /** ICP 备案号（页脚展示并链接工信部），空则不显示 */
  "site.beian": "" as string,
  /** 全站 noindex（私有实例）：robots.txt 全站 Disallow + metadata noindex */
  "site.noindex": false as boolean,
  /** multi-user community mode vs single-user personal blog mode */
  "site.mode": "multi" as "multi" | "single",
  /** single-user mode: the username whose blog IS the site */
  "site.singleUser": "" as string,
  "site.subdomains": false,
  "site.subdomainLocked": true, // subdomain can only be set once
  "site.registrationOpen": true,
  "site.inviteRequired": false,
  /** 账号密码登录与注册总开关：关闭后仅允许 OSS 登录/注册，登录页/注册页/登录弹窗隐藏邮箱表单 */
  "auth.passwordAuth": true,
  "site.force2fa": true,
  "site.maintenance": false as boolean,
  "sso.github": false,
  "sso.google": false,
  "sso.x": false,
  "sso.discourse": false,
  "sso.cfaccess": false,
  "sso.linuxdo": false,
  /** 认证（身份徽章）功能总开关：关闭后前台隐藏认证入口（管理端审核台保留） */
  "verification.enabled": true,
  "moderation.reviewMode": "off" as "off" | "llm" | "manual",
  "moderation.keywordsEnabled": true,
  "moderation.llmFailMode": "open" as "open" | "closed",
  /** per-extension 启用开关（未列出的扩展默认启用；boot/页面/API 三处门控） */
  "ext.enabled": {} as Record<string, boolean>,
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
    /** 审核专用模型覆盖：空 = 平台默认（llm.providers.default） */
    providerId: "" as string,
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
   * 社交登录凭证（管理后台「登录」tab 维护）：per-provider { clientId, clientSecret }。
   * 语义映射：discourse 的 clientId=SSO 地址、clientSecret=HMAC 密钥；cfaccess
   * 的 clientId=Team 域名、clientSecret=AUD（可选）。字段留空回落环境变量
   * （config.oauth.*），密钥经 admin settings GET 脱敏 / POST 留空保留。
   */
  "oauth.providers": {} as Record<
    string,
    { clientId?: string; clientSecret?: string }
  >,
  /**
   * SMTP 邮件发送配置（管理后台维护）：字段留空回落环境变量（config.mail.*）；
   * pass 经 GET 脱敏 / POST 留空保留。transport 按配置指纹失效重建。
   */
  "smtp": {} as {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    from?: string;
  },
  /**
   * 限流桶覆写（见 @/lib/rate-limit/buckets 的 RATE_BUCKETS）：键为桶名
   * （BucketName），未列出的桶用代码内默认值；admin 路由对该键做精确校验
   */
  "ratelimit.buckets": {} as Partial<Record<string, { limit: number; windowSec: number }>>,
} as const;

export type SettingsKey = keyof typeof SETTINGS_DEFAULTS;

/** 扩展启用判定：未列出的 id 视为启用（新增扩展零配置可用）。 */
export async function isExtensionEnabled(id: string): Promise<boolean> {
  const map = (await getSetting("ext.enabled")) as Record<string, boolean>;
  return map?.[id] !== false;
}

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

/* ------------------------------ 站点品牌快照 ------------------------------ */

/** 站点对外品牌/SEO 信息集合 —— footer、metadata、manifest 等共用一次读取
 * （getSettings 自带 React cache + 10s TTL，同请求多处调用无查询放大）。 */
export interface SiteBrand {
  name: string;
  tagline: string;
  description: string;
  keywords: string;
  ogImage: string;
  twitter: string;
  copyright: string;
  beian: string;
  noindex: boolean;
}

export async function getSiteBrand(): Promise<SiteBrand> {
  const s = await getSettings();
  return {
    name: String(s["site.name"] ?? "comit.sh"),
    tagline: String(s["site.tagline"] ?? ""),
    description: String(s["site.description"] ?? ""),
    keywords: String(s["site.keywords"] ?? ""),
    ogImage: String(s["site.ogImage"] ?? ""),
    twitter: String(s["site.twitter"] ?? ""),
    copyright: String(s["site.copyright"] ?? ""),
    beian: String(s["site.beian"] ?? ""),
    noindex: Boolean(s["site.noindex"]),
  };
}
