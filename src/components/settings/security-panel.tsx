"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/utils";
import { apiRequest, copyText, deviceLabel } from "./client";
import type { SessionView } from "./types";

export interface SecurityData {
  twoFactorConfirmed: boolean;
  recoveryCodesCount: number;
  hasPassword: boolean;
  sessions: SessionView[];
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/api/me/password", "POST", {
        currentPassword: hasPassword && current ? current : undefined,
        newPassword: next,
      });
      toast.success(
        locale === "zh" ? "密码已更新，其他设备已下线" : "Password updated; other devices signed out",
      );
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-[var(--muted)] p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{t("settings.security.password")}</h3>
        {!hasPassword && (
          <p className="mt-1 text-sm text-muted-foreground">
            {locale === "zh" ? "当前账号为第三方登录，可不填当前密码直接设置。" : "OAuth account — set a password without the current one."}
          </p>
        )}
      </div>
      <form onSubmit={submit} className="grid max-w-md gap-4">
          {hasPassword && (
            <div className="grid gap-2">
              <Label htmlFor="currentPw">{t("settings.security.currentPassword")}</Label>
              <Input
                id="currentPw"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="newPw">
              {hasPassword ? (locale === "zh" ? "新密码" : "New password") : locale === "zh" ? "设置密码" : "Set password"}
            </Label>
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
            <span className="text-xs text-muted-foreground">{t("auth.passwordWeak")}</span>
          </div>
          <div>
            <Button type="submit" disabled={saving || next.length === 0}>
              {saving && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </div>
        </form>
    </div>
  );
}

function TwoFactorCard({ data }: { data: SecurityData }) {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState(data.recoveryCodesCount);
  const [busy, setBusy] = useState(false);

  async function regen() {
    setBusy(true);
    try {
      const res = await apiRequest<{ codes: string[] }>("/api/me/recovery-codes", "POST");
      setCodes(res.codes);
      setRemaining(res.codes.length);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-[var(--muted)] p-6 space-y-4">
      <h3 className="text-lg font-semibold">{t("auth.2fa.title")}</h3>
      <div className="flex flex-wrap items-center gap-3">
          {data.twoFactorConfirmed ? (
            <Badge variant="success">{t("settings.security.2faOn")}</Badge>
          ) : (
            <Badge variant="warning">{locale === "zh" ? "未启用" : "Not enabled"}</Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {locale === "zh"
              ? `恢复代码剩余 ${remaining} 个`
              : `${remaining} recovery code(s) left`}
          </span>
          <Button variant="outline" size="sm" onClick={regen} disabled={busy || !data.twoFactorConfirmed}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("settings.security.regenRecovery")}
          </Button>
        </div>
        {codes && (
          <div className="rounded-lg border border-border bg-muted/40 p-4">
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
      </div>
  );
}

function SessionsCard({ sessions }: { sessions: SessionView[] }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState(sessions);
  const [busy, setBusy] = useState(false);

  async function revokeOthers() {
    setBusy(true);
    try {
      await apiRequest("/api/me/sessions?keepCurrent=1", "DELETE");
      setList((prev) => prev.filter((s) => s.current));
      toast.success(locale === "zh" ? "已下线其他设备" : "Other devices signed out");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-[var(--muted)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold">{t("settings.security.sessions")}</h3>
          <p className="text-sm text-muted-foreground">
            {locale === "zh" ? `${list.length} 个活跃会话` : `${list.length} active session(s)`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={revokeOthers} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
          {t("settings.security.revokeAll")}
        </Button>
      </div>
      <div className="divide-y divide-border">
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {deviceLabel(s.userAgent)}
                {s.current && <Badge variant="success">{locale === "zh" ? "当前设备" : "This device"}</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.ip ?? "—"} · {locale === "zh" ? "登录于" : "signed in"} {timeAgo(s.createdAt, locale)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SecurityPanel({ data }: { data: SecurityData }) {
  return (
    <div className="space-y-6">
      <PasswordCard hasPassword={data.hasPassword} />
      <TwoFactorCard data={data} />
      <SessionsCard sessions={data.sessions} />
    </div>
  );
}
