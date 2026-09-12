import { config } from "@/core/config";
import type { Locale } from "@/lib/i18n";
import { getSettings, setSetting, type SettingsKey } from "@/lib/settings";
import { layout, renderBuiltinMail, type MailTemplateKey } from "@/lib/mail";

/**
 * Mail template center — registry + admin override layer + rendering.
 *
 * Every mail template has a built-in implementation in `@/lib/mail`
 * (renderBuiltinMail). Admins may override the subject/body per locale from
 * /admin/templates; overrides are stored under the settings key
 * `mailTemplateOverrides` as:
 *
 *   { [templateKey]: { subjectZh?, subjectEn?, bodyZh?, bodyEn?, enabled } }
 *
 * Override bodies are HTML fragments using `{{variable}}` placeholders and are
 * embedded into the shared branded layout(). Empty override fields fall back
 * to the built-in copy; `enabled: false` disables the template entirely
 * (renderMail returns empty strings and the mail channel skips sending).
 */

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export interface MailTemplateDef {
  key: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  variables: string[];
  locale: "both";
}

export const MAIL_TEMPLATES: MailTemplateDef[] = [
  {
    key: "verifyEmail",
    name: { zh: "邮箱验证", en: "Email verification" },
    description: {
      zh: "注册后验证邮箱地址时发送。",
      en: "Sent after signup to verify the email address.",
    },
    variables: ["siteName", "url"],
    locale: "both",
  },
  {
    key: "resetPassword",
    name: { zh: "重置密码", en: "Password reset" },
    description: {
      zh: "用户请求找回密码时发送，链接 30 分钟有效。",
      en: "Sent on password reset request; link valid for 30 minutes.",
    },
    variables: ["siteName", "url"],
    locale: "both",
  },
  {
    key: "commentReply",
    name: { zh: "评论回复", en: "Comment reply" },
    description: {
      zh: "有人评论了用户的文章或回复了用户的评论时发送。",
      en: "Sent when someone comments on a post or replies to a comment.",
    },
    variables: ["siteName", "actor", "post", "excerpt", "url"],
    locale: "both",
  },
  {
    key: "newFollower",
    name: { zh: "新的关注者", en: "New follower" },
    description: {
      zh: "有人关注了用户时发送。",
      en: "Sent when someone follows the user.",
    },
    variables: ["siteName", "actor", "url"],
    locale: "both",
  },
  {
    key: "newMessage",
    name: { zh: "新私信", en: "New message" },
    description: {
      zh: "收到站内私信时发送。",
      en: "Sent when a direct message is received.",
    },
    variables: ["siteName", "actor", "excerpt", "url"],
    locale: "both",
  },
  {
    key: "moderationRejected",
    name: { zh: "审核未通过", en: "Review rejected" },
    description: {
      zh: "文章未通过社区审核时发送。",
      en: "Sent when a post fails community review.",
    },
    variables: ["siteName", "post", "reason", "url"],
    locale: "both",
  },
  {
    key: "accountDeleted",
    name: { zh: "账户已删除", en: "Account deleted" },
    description: {
      zh: "用户注销账户、数据删除完成后发送。",
      en: "Sent after account deletion completes.",
    },
    variables: ["siteName"],
    locale: "both",
  },
  {
    key: "test",
    name: { zh: "SMTP 测试", en: "SMTP test" },
    description: {
      zh: "管理员测试 SMTP 配置时发送。",
      en: "Sent when an admin tests the SMTP configuration.",
    },
    variables: ["siteName"],
    locale: "both",
  },
  {
    key: "system",
    name: { zh: "系统/操作通知", en: "System / operations notice" },
    description: {
      zh: "通用操作通知（封禁、警告、认证审核等 system.* / verification.* 事件），正文由触发点生成。",
      en: "Generic operations notice (bans, warnings, verifications — system.* / verification.* events); copy is generated at the trigger site.",
    },
    variables: ["siteName", "title", "body", "url", "reason"],
    locale: "both",
  },
];

/** Sensible example variable values for the admin preview endpoint. */
export const SAMPLE_TEMPLATE_DATA: Record<string, Record<string, string>> = {
  verifyEmail: { url: `${config.app.url}/auth/verify?token=sample` },
  resetPassword: { url: `${config.app.url}/auth/reset?token=sample` },
  commentReply: {
    actor: "演示用户",
    post: "如何设计一个通知系统",
    excerpt: "写得很好！补充一点：频道分发最好做到失败隔离，避免拖慢主流程。",
    url: `${config.app.url}/p/sample#comments`,
  },
  newFollower: { actor: "演示用户", url: `${config.app.url}/u/demo` },
  newMessage: {
    actor: "演示用户",
    excerpt: "你好，想和你交流一下上篇文章里的思路。",
    url: `${config.app.url}/messages`,
  },
  moderationRejected: {
    post: "示例文章标题",
    reason: "示例驳回原因：部分段落需要修改后重新提交。",
    url: `${config.app.url}/write`,
  },
  accountDeleted: {},
  test: {},
  system: {
    title: "账号封禁通知",
    body: "你的账号因违反社区规范被暂停使用。",
    url: `${config.app.url}/notifications`,
    reason: "违反社区规范（示例）",
  },
};

/* ------------------------------------------------------------------ */
/* Override storage (settings key `mailTemplateOverrides`)             */
/* ------------------------------------------------------------------ */

export interface MailTemplateOverride {
  subjectZh?: string;
  subjectEn?: string;
  bodyZh?: string;
  bodyEn?: string;
  enabled: boolean;
}

export type MailTemplateOverrides = Record<string, MailTemplateOverride>;

const SETTINGS_KEY = "mailTemplateOverrides";

/** Does the override change any copy (vs. only toggling enabled)? */
export function hasCustomCopy(ov: MailTemplateOverride | null | undefined): boolean {
  return Boolean(ov && (ov.subjectZh || ov.subjectEn || ov.bodyZh || ov.bodyEn));
}

function sanitizeOverrides(raw: unknown): MailTemplateOverrides {
  const out: MailTemplateOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[k] = {
      subjectZh: typeof o.subjectZh === "string" ? o.subjectZh : undefined,
      subjectEn: typeof o.subjectEn === "string" ? o.subjectEn : undefined,
      bodyZh: typeof o.bodyZh === "string" ? o.bodyZh : undefined,
      bodyEn: typeof o.bodyEn === "string" ? o.bodyEn : undefined,
      enabled: o.enabled !== false,
    };
  }
  return out;
}

/* renderMail is synchronous (transactional call sites rely on that), so the
   override map is mirrored into a stale-while-revalidate snapshot that the
   sync path can read without awaiting. The async accessors below keep it
   fresh; `peekTemplateOverride` refreshes in the background when stale. */
const g = globalThis as unknown as { __mbTplOverrides?: { data: MailTemplateOverrides; at: number } };
const SNAPSHOT_TTL = 10_000;

async function refreshSnapshot(): Promise<MailTemplateOverrides> {
  const all = await getSettings();
  const data = sanitizeOverrides(all[SETTINGS_KEY]);
  g.__mbTplOverrides = { data, at: Date.now() };
  return data;
}

async function readOverrides(): Promise<MailTemplateOverrides> {
  const snap = g.__mbTplOverrides;
  if (snap && Date.now() - snap.at < SNAPSHOT_TTL) return snap.data;
  return refreshSnapshot();
}

async function writeOverrides(map: MailTemplateOverrides): Promise<void> {
  await setSetting(SETTINGS_KEY as SettingsKey, map);
  g.__mbTplOverrides = { data: map, at: Date.now() };
}

/** Sync snapshot read used by renderMail / renderTemplate. */
export function peekTemplateOverride(key: string): MailTemplateOverride | null {
  const snap = g.__mbTplOverrides;
  if (!snap || Date.now() - snap.at >= SNAPSHOT_TTL) {
    void refreshSnapshot().catch(() => {}); // revalidate in background
  }
  return snap?.data[key] ?? null;
}

/** Current override for one template (merged view used by admin API). */
export async function getTemplateOverride(key: string): Promise<MailTemplateOverride | null> {
  const map = await readOverrides();
  return map[key] ?? null;
}

/** All overrides, keyed by template key. */
export async function listOverrides(): Promise<MailTemplateOverrides> {
  return readOverrides();
}

/** Merge a partial patch into the stored override for one template. */
export async function setTemplateOverride(
  key: string,
  patch: Partial<Omit<MailTemplateOverride, "enabled"> & { enabled: boolean }>,
): Promise<MailTemplateOverride> {
  const map = await readOverrides();
  const current: MailTemplateOverride = map[key] ?? { enabled: true };
  const next: MailTemplateOverride = {
    subjectZh: patch.subjectZh !== undefined ? patch.subjectZh : current.subjectZh,
    subjectEn: patch.subjectEn !== undefined ? patch.subjectEn : current.subjectEn,
    bodyZh: patch.bodyZh !== undefined ? patch.bodyZh : current.bodyZh,
    bodyEn: patch.bodyEn !== undefined ? patch.bodyEn : current.bodyEn,
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
  };
  map[key] = next;
  await writeOverrides(map);
  return next;
}

/** Drop the override for one template (falls back to built-in copy). */
export async function resetTemplateOverride(key: string): Promise<void> {
  const map = await readOverrides();
  if (key in map) {
    delete map[key];
    await writeOverrides(map);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Replace `{{variable}}` placeholders; unknown variables resolve to "". */
function interpolate(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const v = data[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Effective data for any template: `siteName` is always available. */
function withSiteName(data: Record<string, string>): Record<string, string> {
  return { siteName: config.app.name, ...data };
}

/**
 * Render a registered template with overrides merged in.
 * - subject override: `{{var}}` replaced, empty string → built-in subject
 * - body override: `{{var}}` replaced, embedded into the shared layout();
 *   empty string → built-in body
 * Pass `override` explicitly (e.g. preview of unsaved edits) to bypass the
 * stored snapshot.
 */
export function renderTemplate(
  key: string,
  locale: Locale,
  data: Record<string, string>,
  override?: MailTemplateOverride | null,
): { subject: string; html: string; text: string } {
  const zh = locale === "zh";
  if (key === "system") {
    const d = withSiteName(data);
    return renderSystemTemplate(locale, {
      title: d.title ?? "",
      body: d.body ?? "",
      url: d.url || undefined,
      reason: d.reason || undefined,
    }, override);
  }

  const ov = override !== undefined ? override : peekTemplateOverride(key);
  const merged = withSiteName(data);
  const builtin = renderBuiltinMail(key as MailTemplateKey, locale, merged);

  const subjectTpl = zh ? ov?.subjectZh : ov?.subjectEn;
  const subject = subjectTpl ? interpolate(subjectTpl, merged) : builtin.subject;

  const bodyTpl = zh ? ov?.bodyZh : ov?.bodyEn;
  if (bodyTpl && bodyTpl.trim()) {
    const def = MAIL_TEMPLATES.find((t) => t.key === key);
    const html = layout(locale, interpolate(bodyTpl, merged), {
      heading: def ? def.name[locale] : subject,
    });
    return { subject, html, text: builtin.text };
  }
  return { subject, html: builtin.html, text: builtin.text };
}

/**
 * Compose the generic system/operations mail from structured input
 * (used for notification keys prefixed `system.` / `verification.`).
 * `override` may be passed explicitly for preview; otherwise the stored
 * override snapshot is used. Empty override fields fall back to the built-in
 * composition (title/body/reason/url).
 */
export function renderSystemTemplate(
  locale: Locale,
  input: { title: string; body?: string; url?: string; reason?: string },
  override?: MailTemplateOverride | null,
): { subject: string; html: string; text: string } {
  const zh = locale === "zh";
  const ov = override !== undefined ? override : peekTemplateOverride("system");
  const data: Record<string, string> = {
    siteName: config.app.name,
    title: input.title,
    body: input.body ?? "",
    url: input.url ?? "",
    reason: input.reason ?? "",
  };

  const subjectTpl = zh ? ov?.subjectZh : ov?.subjectEn;
  const subject = subjectTpl
    ? interpolate(subjectTpl, data)
    : zh
      ? `【${data.siteName}】${input.title}`
      : `${input.title} · ${data.siteName}`;

  const bodyTpl = zh ? ov?.bodyZh : ov?.bodyEn;
  if (bodyTpl && bodyTpl.trim()) {
    return { subject, html: layout(locale, interpolate(bodyTpl, data), { heading: input.title }), text: input.url ?? "" };
  }

  const parts: string[] = [];
  if (input.body) {
    parts.push(`<p style="color:#333;line-height:1.7;">${escapeHtml(input.body)}</p>`);
  }
  if (input.reason) {
    parts.push(
      `<blockquote style="margin:0;padding:12px 16px;border-left:3px solid #ddd;background:#fafafa;color:#555;">${escapeHtml(input.reason)}</blockquote>`,
    );
  }
  if (input.url) {
    parts.push(
      `<p style="margin-top:16px;"><a href="${escapeHtml(input.url)}" style="color:#2563eb;">${zh ? "查看详情" : "View details"}</a></p>`,
    );
  }
  const body =
    parts.join("") ||
    `<p style="color:#333;line-height:1.7;">${zh ? "请登录站点查看详情。" : "Sign in to view the details."}</p>`;
  return {
    subject,
    html: layout(locale, body, { heading: input.title }),
    text: input.url ?? "",
  };
}

/** renderSystemTemplate + the enabled check (empty result when disabled). */
export function renderSystemMail(
  locale: Locale,
  input: { title: string; body?: string; url?: string; reason?: string },
): { subject: string; html: string; text: string } {
  const ov = peekTemplateOverride("system");
  if (ov && !ov.enabled) {
    console.info("[mail] template \"system\" disabled by override; skip render");
    return { subject: "", html: "", text: "" };
  }
  return renderSystemTemplate(locale, input, ov);
}
