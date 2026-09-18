"use client";

import { useState } from "react";
import { KeyRound, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { Field, SwitchRow } from "@/components/admin/switch-row";
import { postJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/query/keys";
import { useApiMutation } from "@/lib/query/mutation";

/**
 * 管理后台「登录」tab 的两块配置面板：
 *  - OAuthProvidersSection：六家社交登录的凭证（DB 优先、env 兜底），
 *    clientSecret 永不回传（hasSecret 占位），留空保存 = 沿用已存密钥；
 *  - SmtpSection：SMTP 发信配置（同样留空回落 env / 留空保留密码），
 *    附「发送测试邮件」直达管理员的当前邮箱。
 */

interface ProviderDef {
  id: string;
  label: string;
  /** clientId 在该提供商语义下的字段名 */
  idLabel: string;
  /** clientSecret 在该提供商语义下的字段名（空 = 该提供商无密钥概念） */
  secretLabel: string | null;
  hint?: string;
}

const PROVIDER_DEFS: ProviderDef[] = [
  { id: "github", label: "GitHub", idLabel: "Client ID", secretLabel: "Client Secret" },
  { id: "google", label: "Google", idLabel: "Client ID", secretLabel: "Client Secret" },
  { id: "x", label: "X (Twitter)", idLabel: "Client ID（OAuth 2.0 Client）", secretLabel: "Client Secret" },
  { id: "linuxdo", label: "Linux.do", idLabel: "Client ID", secretLabel: "Client Secret" },
  {
    id: "discourse",
    label: "Discourse SSO",
    idLabel: "SSO 端点地址",
    secretLabel: "HMAC 密钥（SSO secret）",
    hint: "Discourse 作为 SSO 提供方：填其 session SSO provider 地址与密钥。",
  },
  {
    id: "cfaccess",
    label: "Cloudflare Access",
    idLabel: "Team 域名",
    secretLabel: "AUD（应用标识，可选）",
    hint: "Team 域名形如 my-team（对应 my-team.cloudflareaccess.com）。",
  },
];

type ProviderSeed = Record<string, { clientId: string; hasSecret: boolean; configured: boolean }>;

export function OAuthProvidersSection({ seed }: { seed: unknown }) {
  const raw = (seed ?? {}) as ProviderSeed;
  const [drafts, setDrafts] = useState<Record<string, { clientId: string; clientSecret: string }>>(() => {
    const out: Record<string, { clientId: string; clientSecret: string }> = {};
    for (const p of PROVIDER_DEFS) {
      out[p.id] = { clientId: raw[p.id]?.clientId ?? "", clientSecret: "" };
    }
    return out;
  });

  const saveMutation = useApiMutation(
    (payload: Record<string, unknown>) => postJson("/api/admin/settings", { entries: payload }),
    { refresh: false, invalidate: [queryKeys.adminSettings()], successToast: "登录凭证已保存" },
  );

  function save() {
    void saveMutation.mutate({
      "oauth.providers": Object.fromEntries(
        PROVIDER_DEFS.map((p) => [p.id, drafts[p.id] ?? { clientId: "", clientSecret: "" }]),
      ),
    });
  }

  return (
    <SettingsSection className="max-w-2xl">
      <SettingsSectionHeader description="社交登录凭证在此维护（数据库存储，优先生效）；字段留空则回落到环境变量配置，密钥留空保存表示保持不变。" />
      <div className="divide-y divide-border">
        {PROVIDER_DEFS.map((p) => {
          const state = raw[p.id];
          const draft = drafts[p.id];
          return (
            <div key={p.id} className="grid gap-3 py-4 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">{p.label}</span>
                <span
                  className={
                    state?.configured
                      ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600"
                      : "rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  }
                >
                  {state?.configured ? "凭证已就绪" : "未配置"}
                </span>
              </div>
              {p.hint && <p className="text-xs leading-relaxed text-muted-foreground">{p.hint}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={p.idLabel}>
                  <Input
                    value={draft?.clientId ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], clientId: e.target.value } }))
                    }
                    placeholder="留空使用环境变量"
                    autoComplete="off"
                  />
                </Field>
                {p.secretLabel && (
                  <Field label={p.secretLabel}>
                    <Input
                      type="password"
                      value={draft?.clientSecret ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], clientSecret: e.target.value } }))
                      }
                      placeholder={state?.hasSecret ? "已配置 — 留空保持不变" : "未配置"}
                      autoComplete="new-password"
                    />
                  </Field>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <SettingsFooter hint="保存后立即对新的登录请求生效（≤10 秒进程缓存）；回调用重定向地址为 {站点地址}/api/auth/oauth/callback/{provider}。">
        <Button onClick={save} disabled={saveMutation.pending}>
          <Save className="size-4" />
          {saveMutation.pending ? "保存中…" : "保存登录凭证"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}

interface SmtpSeed {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  hasPass?: boolean;
}

export function SmtpSection({ seed }: { seed: unknown }) {
  const raw = (seed ?? {}) as SmtpSeed;
  const [host, setHost] = useState(raw.host ?? "");
  const [port, setPort] = useState(String(raw.port ?? 587));
  const [secure, setSecure] = useState(Boolean(raw.secure));
  const [user, setUser] = useState(raw.user ?? "");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState(raw.from ?? "");

  const saveMutation = useApiMutation(
    (payload: Record<string, unknown>) => postJson("/api/admin/settings", { entries: payload }),
    { refresh: false, invalidate: [queryKeys.adminSettings()], successToast: "SMTP 配置已保存" },
  );

  const testMutation = useApiMutation(
    () => postJson<{ message?: string }>("/api/admin/settings/test-mail", {}),
    { refresh: false, successToast: (r) => r.message ?? "测试邮件已发送" },
  );

  function save() {
    const portNum = Number.parseInt(port, 10);
    void saveMutation.mutate({
      smtp: {
        host: host.trim(),
        port: Number.isFinite(portNum) && portNum > 0 ? portNum : 587,
        secure,
        user: user.trim(),
        pass,
        from: from.trim(),
      },
    });
  }

  return (
    <SettingsSection className="max-w-2xl">
      <SettingsSectionHeader description="事务邮件（验证 / 通知）的 SMTP 发信配置：字段留空回落环境变量，密码留空保存表示保持不变。" />
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="SMTP 主机">
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" autoComplete="off" />
          </Field>
          <Field label="端口">
            <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" autoComplete="off" />
          </Field>
        </div>
        <Field label="发件人地址（From）">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="no-reply@example.com" autoComplete="off" />
        </Field>
        <Field label="用户名">
          <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="留空表示无认证 / 使用环境变量" autoComplete="off" />
        </Field>
        <Field label="密码 / 授权码">
          <Input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={raw.hasPass ? "已配置 — 留空保持不变" : "未配置"}
            autoComplete="new-password"
          />
        </Field>
        <SwitchRow
          label="强制 TLS（465 端口直连）"
          description="关闭时使用 STARTTLS 协商（587 常见）；不确定请保持关闭。"
          checked={secure}
          onCheckedChange={setSecure}
          last
        />
      </div>
      <SettingsFooter hint="连接参数变更后自动重建发信连接；建议保存后发送测试邮件确认。">
        <Button
          variant="outline"
          onClick={() => void testMutation.mutate(undefined)}
          disabled={testMutation.pending}
        >
          <Send className="size-4" />
          {testMutation.pending ? "发送中…" : "发送测试邮件"}
        </Button>
        <Button onClick={save} disabled={saveMutation.pending}>
          <Save className="size-4" />
          {saveMutation.pending ? "保存中…" : "保存 SMTP"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
