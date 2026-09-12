"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
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
    <div className="rounded-lg bg-[var(--muted)] p-6 space-y-5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("settings.tab.notifications")}</h3>
        <p className="text-sm text-muted-foreground">{t("settings.notifications.byType")}</p>
      </div>
        <div className="space-y-3">
          {NOTIFICATION_EVENTS.map((event) => (
            <div
              key={event.key}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium">{locale === "zh" ? event.label.zh : event.label.en}</p>
                <p className="font-mono text-xs text-muted-foreground">{event.key}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {channels.map((ch) => {
                  const checked = (prefs[event.key] ?? []).includes(ch.id);
                  return (
                    <label
                      key={ch.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                        checked
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(event.key, ch.id)} />
                      {locale === "zh" ? ch.label.zh : ch.label.en}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t("common.save")}
          </Button>
        </div>
    </div>
  );
}
