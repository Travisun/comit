"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/primitives";
import {
  SettingsFooter,
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { useApiMutation } from "@/lib/query/mutation";
import { apiRequest } from "./client";
import { NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_CHANNELS, type ChannelOption } from "./types";

export function NotificationsPanel({
  channels,
  initialPrefs,
}: {
  channels: ChannelOption[];
  initialPrefs: Record<string, string[]>;
}) {
  const { t, locale } = useI18n();
  const [prefs, setPrefs] = useState<Record<string, string[]>>(() => {
    const base: Record<string, string[]> = {};
    for (const e of NOTIFICATION_EVENTS) {
      base[e.key] = initialPrefs[e.key] ?? DEFAULT_NOTIFICATION_CHANNELS;
    }
    return base;
  });
  const dirty = NOTIFICATION_EVENTS.some((e) => {
    const cur = [...(prefs[e.key] ?? [])].sort().join(",");
    const init = [...(initialPrefs[e.key] ?? DEFAULT_NOTIFICATION_CHANNELS)].sort().join(",");
    return cur !== init;
  });

  function toggle(key: string, channel: string) {
    setPrefs((prev) => {
      const cur = prev[key] ?? [];
      return {
        ...prev,
        [key]: cur.includes(channel) ? cur.filter((c) => c !== channel) : [...cur, channel],
      };
    });
  }

  // 保存通知偏好 — pending 驱动按钮；成功/失败 toast 由统一契约处理
  // （成功文案 t("settings.profile.saved") 与原一致）
  const saveMutation = useApiMutation(
    (payload: Record<string, string[]>) => apiRequest("/api/me/notifications", "PUT", { prefs: payload }),
    { successToast: t("settings.profile.saved") },
  );

  function save() {
    if (saveMutation.pending) return;
    void saveMutation.mutate(prefs);
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.tab.notifications")}
        description={t("settings.notifications.byType")}
      />
      <SettingsPanelList>
        {NOTIFICATION_EVENTS.map((event) => (
          <SettingsPanelRow
            key={event.key}
            title={locale === "zh" ? event.label.zh : event.label.en}
            description={event.key}
            control={
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {channels.map((ch) => {
                  const checked = (prefs[event.key] ?? []).includes(ch.id);
                  return (
                    <label
                      key={ch.id}
                      className="flex cursor-pointer items-center gap-2 text-sm text-[color:var(--text-body)] select-none"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(event.key, ch.id)} />
                      {locale === "zh" ? ch.label.zh : ch.label.en}
                    </label>
                  );
                })}
              </div>
            }
          />
        ))}
      </SettingsPanelList>
      <SettingsFooter
        hint={
          dirty
            ? locale === "zh" ? "更改即时生效于新事件。" : "Changes apply to new events."
            : locale === "zh" ? "没有未保存的更改" : "No unsaved changes"
        }
      >
        <Button onClick={save} disabled={saveMutation.pending || !dirty}>
          {saveMutation.pending && <Loader2 className="animate-spin" />}
          {saveMutation.pending ? (locale === "zh" ? "保存中…" : "Saving…") : t("common.save")}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
