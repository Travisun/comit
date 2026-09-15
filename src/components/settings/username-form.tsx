"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingField,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { cn, subscribeNoop } from "@/lib/utils";
import { apiRequest } from "./client";
import type { SettingsData } from "./types";

type UsernameData = SettingsData["username"];

type Availability =
  | { state: "idle" | "checking" }
  | { state: "ok" }
  | { state: "error"; reason: string };

/**
 * 用户名（主页地址）— /{username} 访问个人主页。
 * 规则：英文开头，仅英文/数字/下划线（下划线不可结尾），3–30 字符，
 * 大小写不区分；保留字与占用实时检查；每 30 天可修改一次。
 */
export function UsernameForm({ data }: { data: UsernameData }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [value, setValue] = useState(data.username);
  const [current, setCurrent] = useState(data.username);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.host, () => "");
  /** which input value the availability result describes (stale-result guard) */
  const [checkedValue, setCheckedValue] = useState<string | null>(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = value.trim().toLowerCase();
  const unchanged = normalized === current;
  const freshCheck = checkedValue === normalized;
  const canSave =
    !unchanged &&
    normalized.length > 0 &&
    availability.state === "ok" &&
    freshCheck;

  // 输入防抖实时检查占用/保留字/格式（setState 全部发生在异步回调内）
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (unchanged || normalized.length === 0) return;
    timer.current = setTimeout(async () => {
      setAvailability({ state: "checking" });
      try {
        const res = await apiRequest<{ ok: boolean; reason?: string }>(
          `/api/me/username?u=${encodeURIComponent(normalized)}`,
          "GET",
        );
        setAvailability(res.ok ? { state: "ok" } : { state: "error", reason: res.reason ?? "不可用" });
        setCheckedValue(normalized);
      } catch {
        setAvailability({ state: "idle" });
        setCheckedValue(normalized);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, current]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ username: string }>("/api/me/username", "PUT", {
        username: normalized,
      });
      setCurrent(res.username);
      setValue(res.username);
      toast.success(zh ? `用户名已更新：${res.username}` : `Username updated: ${res.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inCooldown = data.daysUntilChangeAllowed > 0;
  const cooldownDesc = inCooldown
    ? zh
      ? `用户名每 ${data.cooldownDays} 天仅可修改一次，还需等待 ${data.daysUntilChangeAllowed} 天。`
      : `Usernames can be changed once every ${data.cooldownDays} days — ${data.daysUntilChangeAllowed} days left.`
    : zh
      ? `用户名每 ${data.cooldownDays} 天仅可修改一次。修改后，原地址将不再跳转到你的主页。`
      : `Usernames can be changed once every ${data.cooldownDays} days. Your old URL will stop working after a change.`;

  return (
    <SettingsSection>
      <SettingsSectionHeader
        description={
          zh
            ? "用户名每 30 天仅可修改一次。修改后，原地址将不再跳转到你的主页。"
            : "Usernames can be changed once every 30 days. Your old URL will stop working after a change."
        }
      />
      <form onSubmit={save}>
        <SettingField htmlFor="username">
              <div className="relative flex max-w-md items-center gap-0 overflow-hidden rounded-md border border-input bg-transparent focus-within:border-primary/50">
                <span className="shrink-0 whitespace-nowrap border-r border-border bg-[var(--muted)] px-2.5 py-2 font-mono text-xs text-muted-foreground">
                  {origin ? `${origin}/` : "…/"}
                </span>
                <Input
                  id="username"
                  aria-label={zh ? "用户名" : "Username"}
                  value={value}
                  onChange={(e) => setValue(e.target.value.toLowerCase())}
                  maxLength={data.max + 1}
                  className="rounded-none border-0 bg-transparent pr-9 font-mono shadow-none focus-visible:shadow-none"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={inCooldown}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  {availability.state === "checking" && freshCheck && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {availability.state === "ok" && freshCheck && !unchanged && (
                    <CircleCheck className="size-4 text-emerald-500" />
                  )}
                  {availability.state === "error" && freshCheck && (
                    <CircleX className="size-4 text-destructive" />
                  )}
                </span>
              </div>
            </SettingField>
            <div className="mt-1.5 min-h-5 text-xs">
              {availability.state === "error" && freshCheck && (
                <p className="text-destructive">{availability.reason}</p>
              )}
              {availability.state === "ok" && freshCheck && !unchanged && (
                <p className="text-emerald-600">
                  {zh ? "@用户名 可用" : "Username available"}
                </p>
              )}
              {!inCooldown && availability.state !== "error" && (
                <p className="text-muted-foreground">
                  {zh
                    ? `${data.min}–${data.max} 个字符；英文开头，可含数字与下划线（下划线不可结尾）；不可使用系统保留字。`
                    : `${data.min}–${data.max} characters; must start with a letter; letters, digits and underscores only (no trailing underscore); reserved names are blocked.`}
                </p>
              )}
            </div>
        <SettingsFooter
          hint={
            inCooldown
              ? cooldownDesc
              : unchanged
                ? zh
                  ? "没有未保存的更改"
                  : "No unsaved changes"
                : undefined
          }
        >
          <Button
            type="submit"
            size="sm"
            disabled={saving || !canSave || inCooldown}
            className={cn(inCooldown && "hidden")}
          >
            {saving && <Loader2 className="animate-spin" />}
            {zh ? "保存用户名" : "Save username"}
          </Button>
        </SettingsFooter>
      </form>
    </SettingsSection>
  );
}
