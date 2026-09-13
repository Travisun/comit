"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSectionHeader } from "@/components/ui/settings";
import { Badge } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";
import { apiRequest, copyText } from "./client";
import type { SettingsData } from "./types";

type InvitesData = SettingsData["invites"];

export function InvitesPanel({ data, appUrl }: { data: InvitesData; appUrl: string }) {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState(data.codes);
  const [remaining, setRemaining] = useState(data.remaining);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const res = await apiRequest<{ code: string }>("/api/me/invites", "POST", {});
      setCodes((prev) => [...prev, { code: res.code, usedAt: null, usedByUsername: null }]);
      setRemaining((r) => Math.max(0, r - 1));
      toast.success(locale === "zh" ? `已生成 ${res.code}` : `Generated ${res.code}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(code: string) {
    const link = `${appUrl}/auth/register?invite=${code}`;
    if (await copyText(link)) toast.success(t("common.copied"));
  }

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        title={t("settings.tab.invites")}
        count={codes.length}
        description={t("settings.invites.desc")}
        action={
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button size="sm" onClick={generate} disabled={busy || remaining <= 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("settings.invites.generate")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {remaining > 0
                ? locale === "zh"
                  ? `还可生成 ${remaining} 个`
                  : `${remaining} left`
                : t("settings.invites.limit")}
            </span>
          </div>
        }
      />
      {codes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {locale === "zh" ? "还没有邀请码" : "No invite codes yet"}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {codes.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="font-mono text-sm font-medium">{c.code}</p>
                <p className="text-xs text-muted-foreground">
                  {c.usedAt
                    ? `${t("settings.invites.used")} · ${
                        c.usedByUsername ? `@${c.usedByUsername}` : ""
                      } ${formatDate(c.usedAt, locale)}`
                    : formatDate(new Date().toISOString(), locale)}
                </p>
              </div>
              {!c.usedAt && (
                <div className="flex items-center gap-2">
                  <Badge variant="success">{locale === "zh" ? "未使用" : "Unused"}</Badge>
                  <Button variant="outline" size="sm" onClick={() => void copyLink(c.code)}>
                    <Copy />
                    {t("settings.invites.copy")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
