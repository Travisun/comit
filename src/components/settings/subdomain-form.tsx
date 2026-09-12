"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
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
  const canSave = !isLockedWithSet && value.trim().length > 0;

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
    <div className="rounded-lg bg-[var(--muted)] p-6 space-y-5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("settings.tab.subdomain")}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLockedWithSet ? (
            <Badge variant="warning">{t("settings.subdomain.locked")}</Badge>
          ) : data.locked ? (
            <Badge variant="secondary">{locale === "zh" ? "首次设置后锁定" : "Locked after first set"}</Badge>
          ) : (
            <Badge variant="secondary">
              {t("settings.subdomain.yearly", { used: data.changesThisYear })}
            </Badge>
          )}
          {current && (
            <span className="font-mono text-sm">
              {current}.{data.rootDomain}
            </span>
          )}
        </div>

        {!isLockedWithSet && (
          <form onSubmit={save} className="flex max-w-md flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Input
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
            <Button type="submit" disabled={saving || !canSave}>
              {saving ? <Loader2 className="animate-spin" /> : <Globe />}
              {t("settings.subdomain.set")}
            </Button>
          </form>
        )}
    </div>
  );
}
