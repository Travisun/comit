import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "@/core/config";
import { getSetting } from "@/lib/settings";
import type { Locale } from "@/lib/i18n";
import { hasCustomCopy, peekTemplateOverride, renderTemplate } from "@/lib/mail-templates";

/**
 * SMTP transport（lazy 单例，按配置指纹失效重建）。
 * 配置来源：管理后台设置（settings 表 smtp 键）优先，字段留空回落环境
 * 变量（config.mail.*）—— 后台改完 ≤10s 生效（settings 进程缓存），
 * 连接参数变化时自动换新 transporter。
 */
let transport: Transporter | null = null;
let transportFingerprint = "";

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  enabled: boolean;
}

/** 合并视图：settings 有值用 settings，逐字段回落 env。 */
export async function mailConfig(): Promise<MailConfig> {
  const db = await getSetting("smtp");
  const host = db.host?.trim() || config.mail.host;
  const port = db.port ?? config.mail.port;
  const secure = db.secure ?? config.mail.secure;
  const user = db.user?.trim() || config.mail.user;
  const pass = db.pass || config.mail.pass;
  const from = db.from?.trim() || config.mail.from;
  return { host, port, secure, user, pass, from, enabled: Boolean(host) };
}

/** 回环/本机中转判定：这类 hop 无中间人面，postfix 自签证书可跳过校验。 */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h.startsWith("127.");
}

async function getTransport(cfg: MailConfig): Promise<Transporter> {
  const fingerprint = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (!transport || transportFingerprint !== fingerprint) {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      // 本机 MTA 中转常配自签证书的 STARTTLS，loopback 直连不校验；
      // 远程 SMTP 主机不受影响（保持证书强校验）
      tls: isLoopbackHost(cfg.host) ? { rejectUnauthorized: false } : undefined,
    });
    transportFingerprint = fingerprint;
  }
  return transport;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  /** 可选 HTML 部分；纯文本邮件不要传（保持 multipart 最小化，降低拦截率） */
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const cfg = await mailConfig();
  if (!cfg.enabled) {
    console.warn(`[mail] SMTP disabled; would send "${opts.subject}" to ${opts.to}`);
    return;
  }
  const { html, ...rest } = opts;
  await (await getTransport(cfg)).sendMail({
    from: cfg.from,
    ...rest,
    ...(html ? { html } : {}),
  });
}

export async function verifySmtp(): Promise<boolean> {
  const cfg = await mailConfig();
  if (!cfg.enabled) return false;
  try {
    await (await getTransport(cfg)).verify();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Email templates (bilingual, PLAIN TEXT — 纯文本邮件不触发反垃圾      */
/* 规则/HTML 钓鱼评分，各大邮箱的拦截率显著低于 HTML 模板)              */
/* ------------------------------------------------------------------ */

/** 纯文本公共版式：标题 + 正文 + 页脚（站点名与链接）。 */
export function layout(
  locale: Locale,
  body: string,
  opts: { heading: string; footerNote?: string },
): string {
  const site = config.app.name;
  const url = config.app.url;
  const footer =
    locale === "zh"
      ? `你收到这封邮件是因为注册了 ${site}。如非本人操作请忽略。`
      : `You received this email because you have an account at ${site}. Ignore if this wasn't you.`;
  return [
    opts.heading,
    "",
    body,
    "",
    "--",
    opts.footerNote ?? footer,
    url,
  ].join("\n");
}

export type MailTemplateKey =
  | "verifyEmail"
  | "resetPassword"
  | "commentReply"
  | "newFollower"
  | "newMessage"
  | "moderationRejected"
  | "accountDeleted"
  | "test";

/** Built-in bilingual copy for every transactional template. */
export function renderBuiltinMail(
  key: MailTemplateKey,
  locale: Locale,
  data: Record<string, string>,
): { subject: string; html: string; text: string } {
  const zh_ = locale === "zh";
  switch (key) {
    case "verifyEmail": {
      const subject = zh_ ? `【${config.app.name}】验证你的邮箱` : `Verify your email · ${config.app.name}`;
      const body = zh_
        ? "感谢注册！请打开以下链接完成邮箱验证，验证后即可登录使用："
        : "Thanks for signing up! Open the link below to verify your email address:";
      return {
        subject,
        html: "",
        text: layout(locale, `${body}\n${data.url}`, { heading: zh_ ? "邮箱验证" : "Email verification" }),
      };
    }
    case "resetPassword": {
      const subject = zh_ ? `【${config.app.name}】重置你的密码` : `Reset your password · ${config.app.name}`;
      const body = zh_
        ? "我们收到了你的重置密码请求，链接 30 分钟内有效。若非本人操作请忽略此邮件："
        : "We received a request to reset your password. The link is valid for 30 minutes. Ignore this email if it wasn't you:";
      return {
        subject,
        html: "",
        text: layout(locale, `${body}\n${data.url}`, { heading: zh_ ? "重置密码" : "Password reset" }),
      };
    }
    case "commentReply": {
      const subject = zh_ ? `${data.actor} 评论了你` : `${data.actor} commented on your post`;
      const body = zh_
        ? `${data.actor} 在 «${data.post}» 中评论了你：\n\n${data.excerpt}\n\n查看评论：${data.url}`
        : `${data.actor} commented on «${data.post}»:\n\n${data.excerpt}\n\nView comment: ${data.url}`;
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "新评论" : "New comment" }),
      };
    }
    case "newFollower": {
      const subject = zh_ ? `${data.actor} 关注了你` : `${data.actor} followed you`;
      const body = zh_
        ? `${data.actor} 关注了你，去看看 TA 的主页吧。\n\n查看主页：${data.url}`
        : `${data.actor} followed you. Check out their profile.\n\nView profile: ${data.url}`;
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "新的关注者" : "New follower" }),
      };
    }
    case "newMessage": {
      const subject = zh_ ? `${data.actor} 给你发来了私信` : `${data.actor} sent you a message`;
      const body = zh_
        ? `${data.actor}：${data.excerpt}\n\n回复私信：${data.url}`
        : `${data.actor}: ${data.excerpt}\n\nReply: ${data.url}`;
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "新私信" : "New message" }),
      };
    }
    case "moderationRejected": {
      const subject = zh_ ? `你的文章 «${data.post}» 未通过审核` : `Your post "${data.post}" was rejected`;
      const body = zh_
        ? `很抱歉，你的文章未通过社区审核。原因：\n${data.reason}\n\n修改后重新提交：${data.url}`
        : `Unfortunately your post did not pass community review. Reason:\n${data.reason}\n\nEdit and resubmit: ${data.url}`;
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "审核未通过" : "Review rejected" }),
      };
    }
    case "accountDeleted": {
      const subject = zh_ ? `你的 ${config.app.name} 账户已删除` : `Your ${config.app.name} account has been deleted`;
      const body = zh_
        ? "根据你的请求，账户及个人数据已完成删除。感谢曾经的使用。"
        : "As requested, your account and personal data have been deleted. Thanks for having been with us.";
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "账户已删除" : "Account deleted" }),
      };
    }
    case "test": {
      const subject = zh_ ? `【${config.app.name}】SMTP 测试邮件` : `SMTP test · ${config.app.name}`;
      const body = zh_
        ? "这是一封测试邮件，说明 SMTP 配置工作正常。"
        : "This is a test email — your SMTP configuration works.";
      return {
        subject,
        html: "",
        text: layout(locale, body, { heading: zh_ ? "测试邮件" : "Test email" }),
      };
    }
  }
}

/**
 * Override-aware entry point (same signature as before): consults the admin
 * template override layer (`mailTemplateOverrides` setting, /admin/templates)
 * and falls back to the built-in copy for anything the admin left untouched.
 * A disabled template renders as empty strings so the mail channel can skip
 * sending entirely.
 */
export function renderMail(
  key: MailTemplateKey,
  locale: Locale,
  data: Record<string, string>,
): { subject: string; html: string; text: string } {
  const override = peekTemplateOverride(key);
  if (override && !override.enabled) {
    console.info(`[mail] template "${key}" disabled by override; skip render`);
    return { subject: "", html: "", text: "" };
  }
  if (hasCustomCopy(override)) {
    return renderTemplate(key, locale, data, override);
  }
  return renderBuiltinMail(key, locale, data);
}
