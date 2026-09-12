import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { renderMail } from "@/lib/mail";
import { renderSystemMail, renderTemplate } from "@/lib/mail-templates";
import { sendOperationNotification } from "@/lib/operation-notify";
import { channels, registerChannel, type NotificationChannel, type NotificationMessage, type Plugin, type PluginContext } from "@/core/plugins/types";
import type { Locale } from "@/lib/i18n";

/**
 * Notifications plugin (Laravel-style multi-channel):
 *   notify.send(userId, message) → looks up the user's channel preference
 *   for that notification key and fans out to registered channels.
 * Channels: 'database' (in-site) and 'mail' (SMTP via queue); the webhooks
 * plugin registers 'webhook'. New channels can be added by any plugin.
 */

export const DEFAULT_CHANNELS = ["database", "mail"];

async function userChannels(userId: string, key: string): Promise<string[]> {
  const { users } = await import("@/db/schema");
  const [user] = await db
    .select({ prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.prefs?.[key] ?? DEFAULT_CHANNELS;
}

/** Send a notification to a user through their preferred channels. */
export async function notifySend(userId: string, message: NotificationMessage): Promise<void> {
  const emailEnabled = await getSetting("notify.emailEnabled");
  const chIds = (await userChannels(userId, message.key)).filter(
    (c) => c !== "mail" || emailEnabled,
  );
  const targets = chIds
    .map((id) => channels.get(id))
    .filter((c): c is NotificationChannel => Boolean(c));
  await Promise.all(
    targets.map(async (ch) => {
      try {
        await ch.send(userId, message);
      } catch (err) {
        console.error(`[notify] channel ${ch.id} failed:`, err);
      }
    }),
  );
}

/* ------------------------------ channels -------------------------------- */

const databaseChannel: NotificationChannel = {
  id: "database",
  label: { zh: "站内通知", en: "In-site" },
  async send(userId, message) {
    await db.insert(notifications).values({
      userId,
      key: message.key,
      title: message.title.zh,
      body: message.body?.zh ?? null,
      url: message.url ?? null,
      actorId: message.actorId ?? null,
      payload: message.payload,
    });
  },
};

const mailChannel: NotificationChannel = {
  id: "mail",
  label: { zh: "邮件", en: "Email" },
  async send(userId, message) {
    const { users } = await import("@/db/schema");
    const { queue } = await import("@/core/queue");
    const [user] = await db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return;
    const locale = (user.locale === "en" ? "en" : "zh") as Locale;
    const key = message.key;

    // Operations notices (system.* / verification.*) render through the
    // generic, admin-customizable "system" mail template.
    if (key.startsWith("system.") || key.startsWith("verification.")) {
      const reason = typeof message.payload?.reason === "string" ? message.payload.reason : undefined;
      let rendered = { subject: "", html: "" };
      try {
        rendered = renderSystemMail(locale, {
          title: locale === "zh" ? message.title.zh : message.title.en,
          body: (locale === "zh" ? message.body?.zh : message.body?.en) ?? "",
          url: message.url,
          reason,
        });
      } catch (err) {
        console.error("[notify] system mail render failed:", err);
      }
      if (!rendered.subject) {
        console.info(`[notify] mail skipped: "system" template disabled or rendered empty (key=${key})`);
        return;
      }
      await queue.send("mail.send", { to: user.email, subject: rendered.subject, html: rendered.html });
      return;
    }

    const actorName = String(message.payload?.actorName ?? "");
    const excerpt = message.body?.zh ?? message.title.zh;
    const url = message.url ?? "";
    const tpl = key.startsWith("comment.")
      ? "commentReply"
      : key.startsWith("follow.")
        ? "newFollower"
        : key.startsWith("message.")
          ? "newMessage"
          : key.startsWith("moderation.")
            ? "moderationRejected"
            : null;
    if (!tpl) return; // no email template for this notification type
    const data = {
      actor: actorName,
      post: message.title.zh,
      excerpt,
      url,
      reason: excerpt,
    };
    let subject = "";
    let html = "";
    try {
      ({ subject, html } = renderTemplate(tpl, locale, data));
    } catch (err) {
      console.error(`[notify] template "${tpl}" render failed; falling back to builtin:`, err);
      ({ subject, html } = renderMail(tpl, locale, data));
    }
    if (!subject) {
      console.info(`[notify] mail skipped: template "${tpl}" disabled by override`);
      return;
    }
    await queue.send("mail.send", { to: user.email, subject, html });
  },
};

const plugin: Plugin = {
  name: "notifications",
  description: "Multi-channel notifications (database, mail; extensible)",
  version: "1.1.0",
  register(ctx: PluginContext) {
    registerChannel(databaseChannel);
    registerChannel(mailChannel);

    // Operation events (admin/editor actions) → user notifications via
    // sendOperationNotification (database + mail channels). Failures inside
    // the helper are swallowed so events never break the primary action.
    ctx.events.on("user:banned", ({ userId, bannedUntil, reason, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.ban",
        title: { zh: "账号封禁通知", en: "Account suspended" },
        body: {
          zh: `原因：${reason}；${bannedUntil ? `解封时间：${new Date(bannedUntil).toLocaleString("zh-CN")}` : "此为永久封禁"}`,
          en: `Reason: ${reason}; ${bannedUntil ? `until ${new Date(bannedUntil).toLocaleString("en-US")}` : "this is a permanent ban"}`,
        },
        payload: { bannedUntil, reason, byAdminId },
      });
    });

    ctx.events.on("user:unbanned", ({ userId, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.unban",
        title: { zh: "封禁已解除", en: "Ban lifted" },
        body: {
          zh: "你的账号封禁已解除，所有功能已恢复，欢迎回来。",
          en: "The suspension on your account has been lifted. Welcome back.",
        },
        payload: { byAdminId },
      });
    });

    ctx.events.on("user:warned", ({ userId, message, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.warn",
        title: { zh: "警告通知", en: "Warning notice" },
        body: { zh: message, en: message },
        payload: { message, byAdminId },
      });
    });

    ctx.events.on("verification:approved", ({ userId, type, label }) => {
      void sendOperationNotification(userId, {
        key: "verification.approved",
        title: { zh: "认证审核通过", en: "Verification approved" },
        body: {
          zh: `恭喜！你的「${label}」认证（${type}）已通过审核。`,
          en: `Congratulations! Your "${label}" verification (${type}) has been approved.`,
        },
        payload: { type, label },
      });
    });

    ctx.events.on("verification:rejected", ({ userId, reason }) => {
      void sendOperationNotification(userId, {
        key: "verification.rejected",
        title: { zh: "认证审核未通过", en: "Verification rejected" },
        body: {
          zh: `很抱歉，你的认证申请未通过审核。原因：${reason}`,
          en: `Unfortunately your verification request was rejected. Reason: ${reason}`,
        },
        payload: { reason },
      });
    });
  },
};

export default plugin;
