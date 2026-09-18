"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { routes } from "@/core/routes";
import { apiGet, postJsonSafe, requestSafe } from "@/lib/client/api";
import { useI18n } from "@/lib/i18n/client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../../_components/auth-card";

interface SetupResponse {
  uri: string;
  qrDataUrl: string;
  secret: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export function SetupForm() {
  const { t } = useI18n();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [copied, setCopied] = useState(false);
  // startedRef 防 StrictMode 双跑：/2fa/setup 每次调用都会签发新 TOTP 密钥
  const startedRef = useRef(false);
  // StrictMode 首挂载的 effect 会被 cleanup abort，二次挂载需据此重启首跑
  const abortedRef = useRef(false);

  /**
   * 拉取 2FA 初始化材料（挂载自动跑一次；失败后可经重试按钮重跑）。
   * 传入 signal 时：卸载 abort 会取消在途请求，且 abort 后不再 setState。
   */
  const runSetup = useCallback(
    async (signal?: AbortSignal) => {
      setSetupError(null);
      setSetupLoading(true);
      try {
        const r = await requestSafe<Partial<SetupResponse>>("/api/auth/2fa/setup", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
          signal,
        });
        if (signal?.aborted) return;
        if (!r.ok) {
          setSetupError(r.error ?? t("common.error"));
          return;
        }
        const { uri, qrDataUrl, secret } = r.data;
        if (!uri || !qrDataUrl || !secret) {
          setSetupError(t("common.error"));
          return;
        }
        setSetup({ uri, qrDataUrl, secret });
      } catch {
        // abort 在 requestSafe 里归一为 status 0 失败——静默丢弃即可
        if (signal?.aborted) return;
        setSetupError(t("common.error"));
      } finally {
        if (!signal?.aborted) setSetupLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (startedRef.current) {
      // 二次挂载（StrictMode）：首跑已被 cleanup abort，重启；真实重复渲染不重跑
      if (!abortedRef.current) return;
      abortedRef.current = false;
    } else {
      startedRef.current = true;
    }
    const ac = new AbortController();
    apiGet<{ hasPassword?: boolean }>("/api/me/profile")
      .then((d) => {
        if (!ac.signal.aborted) setNeedsPassword(Boolean(d?.hasPassword === false));
      })
      .catch(() => {});
    void runSetup(ac.signal);
    // 卸载取消在途请求并丢弃结果，避免卸载后 setState
    return () => {
      ac.abort();
      abortedRef.current = true;
    };
  }, [runSetup]);

  const copyAll = useCallback(async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [recoveryCodes]);

  async function onSetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError(null);
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setPwError("密码至少 8 位，需包含字母和数字 / 8+ chars with letters and digits");
      return;
    }
    if (password !== password2) {
      setPwError("两次输入的密码不一致 / Passwords do not match");
      return;
    }
    setPwBusy(true);
    try {
      const r = await postJsonSafe("/api/auth/setup-password", { password });
      if (!r.ok) {
        setPwError(r.error ?? t("common.error"));
        return;
      }
      setPwDone(true);
    } catch {
      setPwError(t("common.error"));
    } finally {
      setPwBusy(false);
    }
  }

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfirmError(null);
    setSubmitting(true);
    try {
      const r = await postJsonSafe<{ recoveryCodes?: string[]; redirect?: string }>("/api/auth/2fa/confirm", { code });
      if (!r.ok) {
        setConfirmError(r.error ?? t("common.error"));
        return;
      }
      const { recoveryCodes } = r.data;
      setAfterUrl(r.data.redirect ?? null);
      if (!recoveryCodes) {
        setConfirmError(t("common.error"));
        return;
      }
      setRecoveryCodes(recoveryCodes);
    } catch {
      setConfirmError(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <AuthBanner tone="success">{t("auth.2fa.recoveryCodes")}</AuthBanner>
        <p className="text-sm text-muted-foreground">{t("auth.2fa.recoveryHint")}</p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-4 font-mono text-sm">
          {recoveryCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copyAll}>
            {copied ? t("auth.2fa.copied") : t("common.copy")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              // 整页跳转：安全设置边界不做 SPA 导航（push+refresh 双 RSC 竞态）
              window.location.replace(afterUrl ?? routes.home);
            }}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    );
  }

  if (setupError) {
    return (
      <div className="flex flex-col gap-3">
        <AuthBanner tone="error">{setupError}</AuthBanner>
        {/* 初始化失败（网络/会话等）可手动重跑，重试期间禁用防复点 */}
        <Button variant="outline" onClick={() => void runSetup()} disabled={setupLoading}>
          {setupLoading ? t("common.loading") : t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!setup) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-[var(--muted)] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        使用认证器 App 扫描下方二维码：支持微信搜索小程序「腾讯令牌」、Authy App、
        Microsoft Authenticator 或 Google Authenticator。
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={setup.qrDataUrl}
        alt="TOTP QR code"
        className="mx-auto size-56 rounded-lg border border-border bg-white p-2"
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="totp-secret">密钥 / Secret key</Label>
        <code className="block overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all select-all">
          {setup.secret}
        </code>
      </div>
      {needsPassword && (
        <form
          onSubmit={onSetPassword}
          className="rounded-lg border border-border p-4 text-left flex flex-col gap-3"
        >
          <div>
            <p className="text-sm font-medium text-foreground">
              {pwDone ? "✓ 登录密码已设置" : "设置登录密码"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pwDone
                ? "你的账户还没有设置过密码，现已完成，可用邮箱 + 密码登录。"
                : "第三方首次注册的账户建议立即设置密码，作为备用登录方式。"}
            </p>
          </div>
          {pwDone ? null : (
            <>
              {pwError ? <AuthBanner tone="error">{pwError}</AuthBanner> : null}
              <div className="grid gap-1.5">
                <Label htmlFor="setup-pw">新密码（至少 8 位，含字母和数字）</Label>
                <Input
                  id="setup-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="setup-pw2">确认新密码</Label>
                <Input
                  id="setup-pw2"
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" variant="outline" size="sm" disabled={pwBusy}>
                {pwBusy && <Loader2 className="animate-spin" />}
                保存密码
              </Button>
            </>
          )}
        </form>
      )}
      <form onSubmit={onConfirm} className="flex flex-col gap-4">
        {confirmError ? <AuthBanner tone="error">{confirmError}</AuthBanner> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-code">{t("auth.2fa.code")}</Label>
          <Input
            id="totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
        </div>
        <Button type="submit" disabled={submitting || code.length !== 6} className="w-full">
          {submitting ? t("common.loading") : t("auth.2fa.confirm")}
        </Button>
      </form>
    </div>
  );
}
