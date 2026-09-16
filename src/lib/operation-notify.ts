import type { NotificationMessage } from "@/core/plugins/types";
import { notifySend } from "@/extensions/notifications/server";

/**
 * Operation notification helper — the single entry point for admin/editor
 * side effects (bans, warnings, verification reviews, …) to reach users.
 *
 * A notice fans out through `notifySend` to every channel the recipient has
 * enabled for the notice key: the in-site `database` channel renders
 * title/body directly, while the `mail` channel renders keys prefixed
 * `system.` / `verification.` through the generic `system` mail template.
 *
 * This function never throws — a notification failure must not break the
 * primary operation that triggered it.
 */

export interface OperationNotice {
  /** Notification key, e.g. "system.ban", "verification.approved". */
  key: string;
  title: { zh: string; en: string };
  body?: { zh: string; en: string };
  url?: string;
  payload?: Record<string, unknown>;
}

export async function sendOperationNotification(
  userId: string,
  notice: OperationNotice,
): Promise<void> {
  try {
    const message: NotificationMessage = {
      key: notice.key,
      title: notice.title,
      body: notice.body,
      url: notice.url,
      payload: notice.payload,
    };
    await notifySend(userId, message);
  } catch (err) {
    console.error(`[operation-notify] failed to deliver "${notice.key}" to ${userId}:`, err);
  }
}
