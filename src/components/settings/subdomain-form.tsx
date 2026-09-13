"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import {
  PropertyRow,
  SettingField,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { apiRequest } from "./client";
import type { SettingsData } from "./types";

type SubdomainData = SettingsData["subdomain"];

export function SubdomainForm({ data }: { data: SubdomainData }) {
  const { t, locale } = useI18n();
  const [value, setValue] = useState(data.subdomain ?? "");
  const [current, setCurrent] = useState(data.subdomain);
  const [saving, setSaving] = useState(false);

  const isLockedWithSet = data.locked && current;
  const canSave = !isLockedWithSet && value.trim().length > 0 && value.trim() !== current;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ subdomain: string }>("/api/me/subdomain", "PUT", {
        subdomain: value.trim(),
      });
      setCurrent(res.subdomain);
      toast.success(
        locale === "zh" ? `子域名已更新：${res.subdomain}` : `Subdomain updated: ${res.subdomain}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const desc = t("settings.subdomain.desc", {
    subdomain: current ?? "your-name",
  }).replace("example.com", data.rootDomain);

  return (
    <SettingsSection>
      <SettingsSectionHeader description={desc} />
      <div className="divide-y divide-border">
        <PropertyRow
          label={locale === "zh" ? "当前子域名" : "Current subdomain"}
          value={
            <span className="inline-flex flex-wrap items-center gap-2">
              {current ? (
                <span className="font-mono">
                  {current}.{data.rootDomain}
                </span>
              ) : (
                locale === "zh" ? "未设置" : "Not set"
              )}
              {isLockedWithSet ? (
                <Badge variant="warning">{t("settings.subdomain.locked")}</Badge>
              ) : data.locked ? (
                <Badge variant="secondary">{locale === "zh" ? "首次设置后锁定" : "Locked after first set"}</Badge>
              ) : (
                <Badge variant="secondary">
                  {t("settings.subdomain.yearly", { used: data.changesThisYear })}
                </Badge>
              )}
            </span>
          }
        />
        <PropertyRow
          label={locale === "zh" ? "独立访问入口" : "Dedicated URL"}
          value={
            current ? (
              <a
                href={`https://${current}.${data.rootDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-link hover:underline"
              >
                https://{current}.{data.rootDomain}
              </a>
            ) : (
              <span className="font-mono">username.{data.rootDomain}</span>
            )
          }
        />
      </div>

      {!isLockedWithSet && (
        <form onSubmit={save} id="subdomain-form" className="max-w-md pt-2">
          <SettingField
            label={t("settings.tab.subdomain")}
            htmlFor="subdomain-input"
            hint={locale === "zh" ? "仅限小写字母、数字与连字符。" : "Lowercase letters, numbers and hyphens only."}
          >
            <div className="relative">
              <Input
                id="subdomain-input"
                value={value}
                onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-name"
                className="pr-32"
                maxLength={63}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                .{data.rootDomain}
              </span>
            </div>
          </SettingField>
        </form>
      )}
      {!isLockedWithSet && (
        <SettingsFooter>
          <Button type="submit" form="subdomain-form" disabled={saving || !canSave}>
            {saving ? <Loader2 className="animate-spin" /> : <Globe />}
            {saving ? (locale === "zh" ? "保存中…" : "Saving…") : t("settings.subdomain.set")}
          </Button>
        </SettingsFooter>
      )}
    </SettingsSection>
  );
}
