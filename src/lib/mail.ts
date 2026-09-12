import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "@/core/config";
import type { Locale } from "@/lib/i18n";
import { hasCustomCopy, peekTemplateOverride, renderTemplate } from "@/lib/mail-templates";

/** Low-level SMTP transport (lazy singleton). */
let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transport;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<void> {
  if (!config.mail.enabled) {
    console.warn(`[mail] SMTP disabled; would send "${opts.subject}" to ${opts.to}`);
    return;
  }
  await getTransport().sendMail({
    from: config.mail.from,
    ...opts,
  });
}

export async function verifySmtp(): Promise<boolean> {
  if (!config.mail.enabled) return false;
  try {
    await getTransport().verify();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Email templates (bilingual, table-based for client compatibility)   */
/* ------------------------------------------------------------------ */

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
  return `<!doctype html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,'PingFang SC','Segoe UI',Roboto,'Noto Sans SC',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #eee;">
          <a href="${url}" style="font-size:18px;font-weight:700;color:#111;text-decoration:none;">${site}</a>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#111;">${opts.heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#888;line-height:1.6;">
          ${opts.footerNote ?? footer}<br/>
          <a href="${url}" style="color:#888;">${url}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(locale: Locale, url: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${label}</a></p>
<p style="font-size:12px;color:#999;word-break:break-all;">${locale === "zh" ? "若按钮无法点击，请复制以下链接到浏览器：" : "If the button doesn't work, copy this link into your browser:"}<br/><a href="${url}" style="color:#666;">${url}</a></p>`;
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
      const body = `<p style="color:#333;line-height:1.7;">${zh_ ? "感谢注册！请点击下方按钮完成邮箱验证，验证后即可登录使用。" : "Thanks for signing up! Click below to verify your email address."}</p>${button(locale, data.url, zh_ ? "验证邮箱" : "Verify email")}`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "邮箱验证" : "Email verification" }), text: data.url };
    }
    case "resetPassword": {
      const subject = zh_ ? `【${config.app.name}】重置你的密码` : `Reset your password · ${config.app.name}`;
      const body = `<p style="color:#333;line-height:1.7;">${zh_ ? "我们收到了你的重置密码请求。链接 30 分钟内有效。若非本人操作请忽略此邮件。" : "We received a request to reset your password. The link is valid for 30 minutes. Ignore this email if it wasn't you."}</p>${button(locale, data.url, zh_ ? "重置密码" : "Reset password")}`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "重置密码" : "Password reset" }), text: data.url };
    }
    case "commentReply": {
      const subject = zh_ ? `${data.actor} 评论了你` : `${data.actor} commented on your post`;
      const body = `<p style="color:#333;line-height:1.7;"><strong>${data.actor}</strong> ${zh_ ? "在" : "commented on"} «${data.post}» ${zh_ ? "中评论了你：" : ":"}</p><blockquote style="margin:0;padding:12px 16px;border-left:3px solid #ddd;background:#fafafa;color:#555;">${data.excerpt}</blockquote><p style="margin-top:16px;"><a href="${data.url}" style="color:#2563eb;">${zh_ ? "查看评论" : "View comment"}</a></p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "新评论" : "New comment" }), text: data.url };
    }
    case "newFollower": {
      const subject = zh_ ? `${data.actor} 关注了你` : `${data.actor} followed you`;
      const body = `<p style="color:#333;line-height:1.7;"><strong>${data.actor}</strong> ${zh_ ? "关注了你，去看看 TA 的主页吧。" : "followed you. Check out their profile."}</p><p><a href="${data.url}" style="color:#2563eb;">${zh_ ? "查看主页" : "View profile"}</a></p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "新的关注者" : "New follower" }), text: data.url };
    }
    case "newMessage": {
      const subject = zh_ ? `${data.actor} 给你发来了私信` : `${data.actor} sent you a message`;
      const body = `<p style="color:#333;line-height:1.7;"><strong>${data.actor}</strong>: ${data.excerpt}</p><p><a href="${data.url}" style="color:#2563eb;">${zh_ ? "回复私信" : "Reply"}</a></p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "新私信" : "New message" }), text: data.url };
    }
    case "moderationRejected": {
      const subject = zh_ ? `你的文章 «${data.post}» 未通过审核` : `Your post "${data.post}" was rejected`;
      const body = `<p style="color:#333;line-height:1.7;">${zh_ ? "很抱歉，你的文章未通过社区审核。原因：" : "Unfortunately your post did not pass community review. Reason:"}</p><blockquote style="margin:0;padding:12px 16px;border-left:3px solid #f87171;background:#fef2f2;color:#7f1d1d;">${data.reason}</blockquote><p style="margin-top:16px;"><a href="${data.url}" style="color:#2563eb;">${zh_ ? "修改后重新提交" : "Edit and resubmit"}</a></p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "审核未通过" : "Review rejected" }), text: data.url };
    }
    case "accountDeleted": {
      const subject = zh_ ? `你的 ${config.app.name} 账户已删除` : `Your ${config.app.name} account has been deleted`;
      const body = `<p style="color:#333;line-height:1.7;">${zh_ ? "根据你的请求，账户及个人数据已完成删除。感谢曾经的使用。" : "As requested, your account and personal data have been deleted. Thanks for having been with us."}</p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "账户已删除" : "Account deleted" }), text: "" };
    }
    case "test": {
      const subject = zh_ ? `【${config.app.name}】SMTP 测试邮件` : `SMTP test · ${config.app.name}`;
      const body = `<p style="color:#333;">${zh_ ? "这是一封测试邮件，说明 SMTP 配置工作正常。" : "This is a test email — your SMTP configuration works."}</p>`;
      return { subject, html: layout(locale, body, { heading: zh_ ? "测试邮件" : "Test email" }), text: "OK" };
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
