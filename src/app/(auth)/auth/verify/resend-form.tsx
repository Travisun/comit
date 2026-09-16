"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { postJsonSafe } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../_components/auth-card";

export function ResendForm() {
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
      const r = await postJsonSafe("/api/auth/resend-verification", { email });
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
    return <AuthBanner tone="success">{t("auth.verifyEmail.sent")}</AuthBanner>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resend-email">{t("auth.email")}</Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("common.loading") : t("auth.verifyEmail.resend")}
      </Button>
    </form>
  );
}
