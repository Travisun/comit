"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/primitives";
import {
  SectionTabs,
  SettingField,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { PageHeader } from "@/components/admin/bits";
import { Field, SwitchRow } from "@/components/admin/switch-row";
import { api } from "@/components/admin/client";
import { useI18n } from "@/lib/i18n/client";

type Switches = Record<string, boolean>;

interface SettingsResponse {
  entries: Record<string, unknown>;
}

const FEATURE_KEYS: { key: string; label: string; desc: string }[] = [
  { key: "site.subdomains", label: "启用子域名访问", desc: "为每位用户分配 username.根域名 的独立访问入口" },
  { key: "site.subdomainLocked", label: "子域名锁定", desc: "每个账号只能设置一次子域名" },
  { key: "site.registrationOpen", label: "开放注册", desc: "关闭后新用户将无法注册" },
  { key: "site.inviteRequired", label: "注册需要邀请码", desc: "仅持有有效邀请码的用户可完成注册" },
  { key: "site.force2fa", label: "强制两步验证", desc: "所有用户登录时必须完成 TOTP 验证" },
];

const SSO_KEYS: { key: string; label: string }[] = [
  { key: "sso.github", label: "GitHub" },
  { key: "sso.google", label: "Google" },
  { key: "sso.x", label: "X (Twitter)" },
  { key: "sso.discourse", label: "Discourse" },
  { key: "sso.cfaccess", label: "Cloudflare Access" },
];

type AdminTab = "general" | "mode" | "features" | "login";

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<AdminTab>("general");

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"multi" | "single">("multi");
  const [singleUser, setSingleUser] = useState("");
  const [switches, setSwitches] = useState<Switches>({});

  // single-user datalist suggestions
  const [suggestions, setSuggestions] = useState<{ username: string; displayName: string }[]>([]);

  useEffect(() => {
    api<SettingsResponse>("/api/admin/settings")
      .then(({ entries }) => {
        setName(String(entries["site.name"] ?? ""));
        setTagline(String(entries["site.tagline"] ?? ""));
        setDescription(String(entries["site.description"] ?? ""));
        setMode(entries["site.mode"] === "single" ? "single" : "multi");
        setSingleUser(String(entries["site.singleUser"] ?? ""));
        const next: Switches = {};
        for (const k of [...FEATURE_KEYS, ...SSO_KEYS].map((k) => k.key)) {
          next[k] = Boolean(entries[k]);
        }
        next["notify.emailEnabled"] = Boolean(entries["notify.emailEnabled"]);
        setSwitches(next);
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  // debounced username suggestions for single-user mode
  useEffect(() => {
    const q = singleUser.trim();
    const timer = setTimeout(() => {
      if (mode !== "single" || !q) {
        setSuggestions([]);
        return;
      }
      api<{ items: { username: string; displayName: string }[] }>(
        `/api/admin/users?q=${encodeURIComponent(q)}&limit=8`,
      )
        .then((d) => setSuggestions(d.items))
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, singleUser]);

  async function save() {
    setSaving(true);
    try {
      await api("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({
          entries: {
            "site.name": name.trim(),
            "site.tagline": tagline.trim(),
            "site.description": description.trim(),
            "site.mode": mode,
            "site.singleUser": singleUser.trim(),
            ...Object.fromEntries(FEATURE_KEYS.map((k) => [k.key, switches[k.key] ?? false])),
            ...Object.fromEntries(SSO_KEYS.map((k) => [k.key, switches[k.key] ?? false])),
            "notify.emailEnabled": switches["notify.emailEnabled"] ?? false,
          },
        }),
      });
      toast.success("设置已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="站点设置" description="站点信息、模式与功能开关" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="站点设置"
        description="站点信息、模式与功能开关"
        actions={
          <Button onClick={save} disabled={saving}>
            <Save className="size-4" />
            {saving ? "保存中…" : "保存设置"}
          </Button>
        }
      />

      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as AdminTab)}
        tabs={[
          { id: "general", label: "常规" },
          { id: "mode", label: "用户模式" },
          { id: "features", label: "功能开关" },
          { id: "login", label: "登录" },
        ]}
      />

      {tab === "general" && (
        <SettingsSection className="max-w-2xl">
          <SettingsSectionHeader description="站点对外展示的基本信息" />
          <div className="grid gap-4">
            <Field label="站点名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="comit.sh" />
            </Field>
            <Field label="副标题">
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </Field>
            <Field label="站点描述">
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </SettingsSection>
      )}

      {tab === "mode" && (
        <SettingsSection className="max-w-2xl">
          <SettingsSectionHeader description={t("admin.settings.modeHint")} />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { value: "multi", title: "多用户社区", desc: "首页展示社区信息流，用户各自拥有空间" },
                { value: "single", title: "单用户博客", desc: "首页即为指定用户的个人博客" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                aria-pressed={mode === opt.value}
                className={
                  mode === opt.value
                    ? "flex flex-col items-start gap-1 rounded-md border border-primary bg-[color-mix(in_srgb,var(--primary)_5%,transparent)] p-3 text-left"
                    : "flex flex-col items-start gap-1 rounded-md border border-border p-3 text-left transition-colors hover:bg-[var(--hover)]"
                }
              >
                <span className="text-sm font-semibold">{opt.title}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
            {mode === "single" ? (
              <div className="sm:col-span-2">
                <Field label="单用户账号" hint="输入用户名，从联想列表中选择">
                  <Input
                    value={singleUser}
                    onChange={(e) => setSingleUser(e.target.value)}
                    list="admin-single-user-options"
                    placeholder="username"
                    autoComplete="off"
                  />
                  <datalist id="admin-single-user-options">
                    {suggestions.map((s) => (
                      <option key={s.username} value={s.username}>
                        {s.displayName}
                      </option>
                    ))}
                  </datalist>
                </Field>
              </div>
            ) : null}
          </div>
          <SettingsFooter hint="更改站点模式会立即改变首页形态。">
            <Button onClick={save} disabled={saving}>
              <Save className="size-4" />
              {saving ? "保存中…" : "保存设置"}
            </Button>
          </SettingsFooter>
        </SettingsSection>
      )}

      {tab === "features" && (
        <SettingsSection>
          <SettingsSectionHeader description="控制注册、域名与安全相关能力" />
          <div>
            {FEATURE_KEYS.map((k, i) => (
              <SwitchRow
                key={k.key}
                label={k.label}
                description={k.desc}
                checked={switches[k.key] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k.key]: v }))}
                last={i === FEATURE_KEYS.length - 1}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      {tab === "login" && (
        <SettingsSection className="max-w-2xl">
          <SettingsSectionHeader description="第三方登录与事务邮件。开启 SSO 前需同时配置对应的环境变量密钥（client id / secret）。" />
          <div>
            {SSO_KEYS.map((k, i) => (
              <SwitchRow
                key={k.key}
                label={k.label}
                checked={switches[k.key] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k.key]: v }))}
                last={false}
              />
            ))}
            <SwitchRow
              label="启用邮件发送"
              description="关闭后验证码/通知邮件将不再发出（需已配置 SMTP）"
              checked={switches["notify.emailEnabled"] ?? false}
              onCheckedChange={(v) => setSwitches((s) => ({ ...s, "notify.emailEnabled": v }))}
              last
            />
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
