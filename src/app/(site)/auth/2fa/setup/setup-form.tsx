"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { routes } from "@/core/routes";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../../_components/auth-card";

interface SetupResponse {
  uri: string;
  qrDataUrl: string;
  secret: string;
}

export function SetupForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as Partial<SetupResponse> & { error?: string };
        if (!res.ok || !data.uri || !data.qrDataUrl || !data.secret) {
          setSetupError(data.error ?? t("common.error"));
          return;
        }
        setSetup({ uri: data.uri, qrDataUrl: data.qrDataUrl, secret: data.secret });
      } catch {
        setSetupError(t("common.error"));
      }
    })();
  }, [t]);

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

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfirmError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { recoveryCodes?: string[]; error?: string };
      if (!res.ok || !data.recoveryCodes) {
        setConfirmError(data.error ?? t("common.error"));
        return;
      }
      setRecoveryCodes(data.recoveryCodes);
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
              router.push(routes.home);
              router.refresh();
            }}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    );
  }

  if (setupError) {
    return <AuthBanner tone="error">{setupError}</AuthBanner>;
  }

  if (!setup) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
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
