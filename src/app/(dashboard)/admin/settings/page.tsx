"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator, Skeleton } from "@/components/ui/primitives";
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

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
          <Card key={i}>
            <CardContent className="space-y-3 pt-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
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

      <div className="space-y-5">
        {/* 常规 */}
        <Card>
          <CardHeader>
            <CardTitle>常规</CardTitle>
            <CardDescription>站点对外展示的基本信息</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="站点名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="comit.sh" />
            </Field>
            <Field label="副标题">
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </Field>
            <Field label="站点描述">
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        {/* 模式 */}
        <Card>
          <CardHeader>
            <CardTitle>用户模式</CardTitle>
            <CardDescription>{t("admin.settings.modeHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
                className={
                  mode === opt.value
                    ? "flex flex-col items-start gap-1 rounded-lg border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary"
                    : "flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/60"
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
          </CardContent>
        </Card>

        {/* 功能开关 */}
        <Card>
          <CardHeader>
            <CardTitle>功能开关</CardTitle>
            <CardDescription>控制注册、域名与安全相关能力</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* SSO */}
        <Card>
          <CardHeader>
            <CardTitle>SSO / OAuth 登录</CardTitle>
            <CardDescription>开启前需同时配置对应的环境变量密钥（client id / secret）</CardDescription>
          </CardHeader>
          <CardContent>
            {SSO_KEYS.map((k, i) => (
              <SwitchRow
                key={k.key}
                label={k.label}
                checked={switches[k.key] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k.key]: v }))}
                last={i === SSO_KEYS.length - 1}
              />
            ))}
          </CardContent>
        </Card>

        {/* 邮件 */}
        <Card>
          <CardHeader>
            <CardTitle>邮件通知</CardTitle>
            <CardDescription>验证邮件、找回密码等事务邮件的发送开关</CardDescription>
          </CardHeader>
          <CardContent>
            <SwitchRow
              label="启用邮件发送"
              description="关闭后验证码/通知邮件将不再发出（需已配置 SMTP）"
              checked={switches["notify.emailEnabled"] ?? false}
              onCheckedChange={(v) => setSwitches((s) => ({ ...s, "notify.emailEnabled": v }))}
              last
            />
          </CardContent>
        </Card>

        <Separator />
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} size="lg">
            <Save className="size-4" />
            {saving ? "保存中…" : "保存设置"}
          </Button>
        </div>
      </div>
    </div>
  );
}
