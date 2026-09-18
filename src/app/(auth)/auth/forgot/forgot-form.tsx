"use client";

import { useState } from "react";
import Link from "next/link";
import { routes } from "@/core/routes";
import { useI18n } from "@/lib/i18n/client";
import { postJsonSafe } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../_components/auth-card";

export function ForgotForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await postJsonSafe("/api/auth/forgot", { email });
      if (!r.ok) {
        setError(r.error ?? t("common.error"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <AuthBanner tone="success">{t("auth.forgot.sent")}</AuthBanner>
        <p className="text-xs text-muted-foreground">{t("auth.forgot.spam")}</p>
        <Link href={routes.login} className="text-sm text-link hover:underline">
          {t("auth.forgot.backLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">{t("auth.email")}</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("common.loading") : t("auth.forgot.title")}
      </Button>
    </form>
  );
}
