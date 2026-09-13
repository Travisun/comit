"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/primitives";
import {
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
  SettingRow,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { apiRequest } from "./client";
import { NOTIFICATION_EVENTS, type ChannelOption } from "./types";

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
      base[e.key] = initialPrefs[e.key] ?? ["database"];
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const dirty = NOTIFICATION_EVENTS.some((e) => {
    const cur = [...(prefs[e.key] ?? [])].sort().join(",");
    const init = [...(initialPrefs[e.key] ?? ["database"])].sort().join(",");
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

  async function save() {
    setSaving(true);
    try {
      await apiRequest("/api/me/notifications", "PUT", { prefs });
      toast.success(t("settings.profile.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.tab.notifications")}
        description={t("settings.notifications.byType")}
      />
      <div className="divide-y divide-border">
        {NOTIFICATION_EVENTS.map((event) => (
          <SettingRow
            key={event.key}
            label={locale === "zh" ? event.label.zh : event.label.en}
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
      </div>
      <SettingsFooter
        hint={
          dirty
            ? locale === "zh" ? "更改即时生效于新事件。" : "Changes apply to new events."
            : locale === "zh" ? "没有未保存的更改" : "No unsaved changes"
        }
      >
        <Button onClick={save} disabled={saving || !dirty}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? (locale === "zh" ? "保存中…" : "Saving…") : t("common.save")}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
