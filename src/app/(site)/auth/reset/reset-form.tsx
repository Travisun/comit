"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../_components/auth-card";

function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

export function ResetForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (!isValidPassword(password)) {
      setError(t("auth.passwordWeak"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("common.error"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <AuthBanner tone="success">{t("auth.reset.success")}</AuthBanner>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">{t("auth.reset.newPassword")}</Label>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("auth.passwordWeak")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-confirm">{t("auth.confirmPassword")}</Label>
        <Input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("common.loading") : t("auth.reset.title")}
      </Button>
    </form>
  );
}
