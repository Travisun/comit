import type { NotificationMessage } from "@/core/plugins/types";

/** 通知模板注册制（D6）— key 约定 ext.<id>.<event>。 */
export type NotificationTemplate = (vars: Record<string, string>) => Omit<NotificationMessage, "key"> & {
  key?: string;
};

const g = globalThis as unknown as { __mbNotifyTemplates?: Map<string, NotificationTemplate> };
const templates: Map<string, NotificationTemplate> = (g.__mbNotifyTemplates ??= new Map());

export function registerNotificationTemplate(key: string, builder: NotificationTemplate): void {
  templates.set(key, builder);
}

export function buildNotification(key: string, vars: Record<string, string> = {}): NotificationMessage | null {
  const builder = templates.get(key);
  if (!builder) return null;
  return { key, ...builder(vars) };
}

export function listNotificationTemplates(): string[] {
  return [...templates.keys()];
}
