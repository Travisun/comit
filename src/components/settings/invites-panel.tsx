"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSectionHeader } from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import { apiRequest, copyText } from "./client";
import type { SettingsData } from "./types";

type InvitesData = SettingsData["invites"];

/**
 * 邀请码一览 — 用量概览（额度进度）+ 状态时间线列表。
 * 设计要点：数据一眼可读（总额度/已使用/可用），每行状态用色点而非
 * 大色块徽章，邀请码等宽字体突出，复制动作只出现在可用行。
 */
export function InvitesPanel({ data, appUrl }: { data: InvitesData; appUrl: string }) {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState(data.codes);
  const [remaining, setRemaining] = useState(data.remaining);
  const [busy, setBusy] = useState(false);

  const used = codes.filter((c) => c.usedAt).length;
  const total = data.max;
  const usedPct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));

  async function generate() {
    setBusy(true);
    try {
      const res = await apiRequest<{ code: string }>("/api/me/invites", "POST", {});
      setCodes((prev) => [
        { code: res.code, createdAt: new Date().toISOString(), usedAt: null, usedByUsername: null },
        ...prev,
      ]);
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
    <div className="space-y-6">
      <SettingsSectionHeader description={t("settings.invites.desc")} />

      {/* 用量概览 */}
      <div className="rounded-lg border border-border">
        <div className="grid grid-cols-3 divide-x divide-border">
          <Stat label={locale === "zh" ? "总额度" : "Quota"} value={total} />
          <Stat label={locale === "zh" ? "已使用" : "Used"} value={used} />
          <Stat label={locale === "zh" ? "可生成" : "Available"} value={remaining} emphasize />
        </div>
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{locale === "zh" ? "额度使用" : "Quota usage"}</span>
            <span className="num">{usedPct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${usedPct}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {remaining > 0
              ? locale === "zh"
                ? `还可生成 ${remaining} 个邀请码`
                : `${remaining} invites left`
              : t("settings.invites.limit")}
          </p>
          <Button size="sm" onClick={generate} disabled={busy || remaining <= 0}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("settings.invites.generate")}
          </Button>
        </div>
      </div>

      {/* 邀请码列表 */}
      {codes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {locale === "zh" ? "还没有邀请码，点击上方「生成邀请码」创建第一个。" : "No invite codes yet — generate your first one above."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border bg-[var(--muted)] px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>{locale === "zh" ? "邀请码" : "Code"}</span>
            <span>{locale === "zh" ? "状态 / 操作" : "Status / Actions"}</span>
          </div>
          <ul className="divide-y divide-border">
            {codes.map((c) => {
              const isUsed = Boolean(c.usedAt);
              return (
                <li key={c.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--hover,#f7f8f8)]">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-mono text-sm font-medium tracking-wide">
                      {c.code}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {locale === "zh" ? "创建于" : "Created"} {formatDate(c.createdAt, locale)}
                      {isUsed && c.usedByUsername
                        ? ` · ${locale === "zh" ? "已被" : "used by"} @${c.usedByUsername} ${locale === "zh" ? "使用" : ""}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        isUsed ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          isUsed ? "bg-muted-foreground/50" : "bg-emerald-500",
                        )}
                        aria-hidden
                      />
                      {isUsed
                        ? `${t("settings.invites.used")}${c.usedAt ? ` · ${formatDate(c.usedAt, locale)}` : ""}`
                        : locale === "zh"
                          ? "未使用"
                          : "Unused"}
                    </span>
                    {!isUsed && (
                      <Button variant="outline" size="sm" onClick={() => void copyLink(c.code)}>
                        <Copy />
                        {t("settings.invites.copy")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "num mt-0.5 text-xl leading-7",
          emphasize ? "font-semibold text-foreground" : "font-medium text-foreground/80",
        )}
      >
        {value}
      </p>
    </div>
  );
}