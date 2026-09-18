"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { startRegistration } from "@simplewebauthn/browser";
import { Eye, EyeOff, Fingerprint, KeyRound, Loader2, LogOut, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import {
  Notice,
  SectionTabs,
  SettingField,
  SettingsFooter,
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { timeAgo } from "@/lib/utils";
import { apiGet } from "@/lib/client/api";
import { apiRequest, copyText, deviceLabel } from "./client";
import type { SessionView } from "./types";

export interface SecurityData {
  twoFactorConfirmed: boolean;
  recoveryCodesCount: number;
  hasPassword: boolean;
  passkeysEnabled: boolean;
  sessions: SessionView[];
}

interface PasskeyView {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);

  const saveMutation = useApiMutation(
    (input: { currentPassword?: string; newPassword: string }) =>
      apiRequest("/api/me/password", "POST", input),
    {
      // 保持原行为等价：成功只清空表单，不触发 RSC 回流
      refresh: false,
      successToast:
        locale === "zh" ? "密码已更新，其他设备已下线" : "Password updated; other devices signed out",
      onSuccess: () => {
        setCurrent("");
        setNext("");
      },
    },
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saveMutation.pending) return;
    void saveMutation.mutate({
      currentPassword: hasPassword && current ? current : undefined,
      newPassword: next,
    });
  }

  return (
    <SettingsSection>
      {!hasPassword && (
        <p className="text-sm text-muted-foreground">
          {locale === "zh"
            ? "当前账号为第三方登录，可不填当前密码直接设置。"
            : "OAuth account — set a password without the current one."}
        </p>
      )}
      <form onSubmit={submit} className="grid max-w-md gap-4">
        {hasPassword && (
          <SettingField label={t("settings.security.currentPassword")} htmlFor="currentPw">
            <Input
              id="currentPw"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </SettingField>
        )}
        <SettingField
          label={
            hasPassword
              ? locale === "zh"
                ? "新密码"
                : "New password"
              : locale === "zh"
                ? "设置密码"
                : "Set password"
          }
          htmlFor="newPw"
          hint={t("auth.passwordWeak")}
        >
          <div className="relative">
            <Input
              id="newPw"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={next}
              placeholder={t("auth.passwordWeak")}
              onChange={(e) => setNext(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              aria-label="toggle visibility"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </SettingField>
        <SettingsFooter>
          <Button type="submit" disabled={saveMutation.pending || next.length === 0}>
            {saveMutation.pending && <Loader2 className="animate-spin" />}
            {saveMutation.pending ? (locale === "zh" ? "保存中…" : "Saving…") : t("common.save")}
          </Button>
        </SettingsFooter>
      </form>
    </SettingsSection>
  );
}

function TwoFactorCard({ data }: { data: SecurityData }) {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState(data.recoveryCodesCount);

  const regenMutation = useApiMutation(
    () => apiRequest<{ codes: string[] }>("/api/me/recovery-codes", "POST"),
    {
      // 保持原行为等价：成功只更新本地恢复代码展示，不触发 RSC 回流
      refresh: false,
      onSuccess: (res) => {
        setCodes(res.codes);
        setRemaining(res.codes.length);
      },
    },
  );

  return (
    <SettingsSection>
      {!data.twoFactorConfirmed && (
        <Notice tone="warning" className="mb-4">
          {locale === "zh"
            ? "尚未启用两步验证 — 建议前往认证页开启。"
            : "Two-factor auth is off — enable it from the Verification page."}
        </Notice>
      )}
      <SettingsPanelList>
        <SettingsPanelRow
          icon={<ShieldCheck className="size-4" />}
          title={locale === "zh" ? "两步验证" : "Two-factor"}
          control={
            data.twoFactorConfirmed ? (
              <Badge variant="success">{t("settings.security.2faOn")}</Badge>
            ) : (
              <Badge variant="warning">{locale === "zh" ? "未启用" : "Not enabled"}</Badge>
            )
          }
        />
        <SettingsPanelRow
          icon={<KeyRound className="size-4" />}
          title={locale === "zh" ? "恢复代码" : "Recovery codes"}
          description={
            locale === "zh" ? `剩余 ${remaining} 个` : `${remaining} code(s) left`
          }
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void regenMutation.mutate(undefined)}
              disabled={regenMutation.pending || !data.twoFactorConfirmed}
            >
              {regenMutation.pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("settings.security.regenRecovery")}
            </Button>
          }
        />
      </SettingsPanelList>
      {codes && (
        <div className="mt-4 rounded-md border border-border bg-[var(--muted)] p-4">
          <p className="mb-2 text-sm">{t("auth.2fa.recoveryHint")}</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
            {codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={async () => {
              if (await copyText(codes.join("\n"))) toast.success(t("common.copied"));
            }}
          >
            {t("common.copy")}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function SessionsCard({ sessions }: { sessions: SessionView[] }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState(sessions);

  const revokeMutation = useApiMutation(
    () => apiRequest("/api/me/sessions?keepCurrent=1", "DELETE"),
    {
      // 保持原行为等价：成功只收缩本地列表，不触发 RSC 回流
      refresh: false,
      successToast: locale === "zh" ? "已下线其他设备" : "Other devices signed out",
      onSuccess: () => setList((prev) => prev.filter((s) => s.current)),
    },
  );

  return (
    <SettingsSection>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {locale === "zh"
            ? `${list.length} 个活跃会话。下线不认识的设备以保护账号。`
            : `${list.length} active session(s). Sign out devices you don't recognize.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void revokeMutation.mutate(undefined)}
          disabled={revokeMutation.pending}
        >
          {revokeMutation.pending ? <Loader2 className="animate-spin" /> : <LogOut />}
          {t("settings.security.revokeAll")}
        </Button>
      </div>
      <SettingsPanelList>
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                {deviceLabel(s.userAgent)}
                {s.current && <Badge variant="success">{locale === "zh" ? "当前设备" : "This device"}</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.ip ?? "—"} · {locale === "zh" ? "登录于" : "signed in"} {timeAgo(s.createdAt, locale)}
              </p>
            </div>
          </div>
        ))}
      </SettingsPanelList>
    </SettingsSection>
  );
}

function PasskeysCard() {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const [ceremonyError, setCeremonyError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: queryKeys.passkeys(),
    queryFn: async () =>
      (await apiGet<{ passkeys: PasskeyView[] }>("/api/me/passkeys")).passkeys,
    initialData: [],
  });
  const passkeys = listQ.data ?? [];

  const deleteMutation = useApiMutation((id: string) => apiRequest(`/api/me/passkeys/${id}`, "DELETE"), {
    refresh: false,
    invalidate: [queryKeys.passkeys()],
    successToast: locale === "zh" ? "通行密钥已删除" : "Passkey deleted",
  });

  // WebAuthn 注册仪式：拉 options → 浏览器弹窗 → 服务端校验落库
  const registerMutation = useApiMutation(
    async (input: { name: string; response: unknown }) =>
      apiRequest<{ name: string }>("/api/auth/passkeys/register", "POST", input),
    {
      refresh: false,
      invalidate: [queryKeys.passkeys()],
      successToast: locale === "zh" ? "通行密钥已注册" : "Passkey registered",
      onSuccess: () => {
        setName("");
        setCeremonyError(null);
      },
    },
  );

  async function onRegister() {
    setCeremonyError(null);
    try {
      const options = await apiGet<Record<string, unknown>>("/api/auth/passkeys/register/options");
      const response = await startRegistration({ optionsJSON: options as never });
      registerMutation.mutate({ name: name.trim() || (locale === "zh" ? "我的通行密钥" : "My passkey"), response });
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") return; // 用户取消
      setCeremonyError(e instanceof Error ? e.message : t("common.error"));
    }
  }

  return (
    <SettingsSection>
      <p className="text-sm text-muted-foreground">{t("auth.passkey.desc")}</p>
      <div className="grid max-w-md gap-3">
        <SettingField label={t("auth.passkey.name")} htmlFor="passkey-name">
          <div className="flex gap-2">
            <Input
              id="passkey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={locale === "zh" ? "例如：MacBook 指纹" : "e.g. MacBook Touch ID"}
              maxLength={120}
            />
            <Button
              type="button"
              onClick={() => void onRegister()}
              disabled={registerMutation.pending}
              className="shrink-0"
            >
              {registerMutation.pending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("auth.passkey.add")}
            </Button>
          </div>
        </SettingField>
        {ceremonyError ? <Notice tone="danger">{ceremonyError}</Notice> : null}
      </div>

      {passkeys.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t("auth.passkey.empty")}</p>
      ) : (
        <SettingsPanelList>
          {passkeys.map((pk) => (
            <SettingsPanelRow
              key={pk.id}
              icon={<Fingerprint className="size-4" />}
              title={pk.name}
              description={`${t("auth.passkey.lastUsed")} ${
                pk.lastUsedAt ? timeAgo(pk.lastUsedAt, locale) : locale === "zh" ? "从未" : "never"
              }`}
              control={
                <div className="flex items-center gap-2">
                  <Badge variant={pk.deviceType === "multiDevice" ? "success" : "secondary"}>
                    {pk.deviceType === "multiDevice" ? t("auth.passkey.synced") : t("auth.passkey.thisDevice")}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={deleteMutation.pending}
                    onClick={() => void deleteMutation.mutate(pk.id)}
                  >
                    <Trash2 />
                    {t("auth.passkey.delete")}
                  </Button>
                </div>
              }
            />
          ))}
        </SettingsPanelList>
      )}
    </SettingsSection>
  );
}

type SecurityTab = "password" | "twoFactor" | "passkeys" | "sessions";

export function SecurityPanel({ data }: { data: SecurityData }) {
  const { locale } = useI18n();
  const [tab, setTab] = useState<SecurityTab>("password");

  const tabs = [
    { id: "password", label: locale === "zh" ? "密码" : "Password" },
    { id: "twoFactor", label: locale === "zh" ? "两步验证" : "Two-factor" },
    ...(data.passkeysEnabled
      ? [{ id: "passkeys" as const, label: locale === "zh" ? "通行密钥" : "Passkeys" }]
      : []),
    { id: "sessions", label: locale === "zh" ? "登录会话" : "Sessions" },
  ];

  return (
    <div className="space-y-6">
      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as SecurityTab)}
        tabs={tabs}
      />
      {tab === "password" && <PasswordCard hasPassword={data.hasPassword} />}
      {tab === "twoFactor" && <TwoFactorCard data={data} />}
      {tab === "passkeys" && <PasskeysCard />}
      {tab === "sessions" && <SessionsCard sessions={data.sessions} />}
    </div>
  );
}
