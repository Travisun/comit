"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { routes } from "@/core/routes";
import { postJsonSafe } from "@/lib/client/api";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../_components/auth-card";
import { PasskeyButton } from "./passkey-button";

export function LoginForm({ passkeysEnabled = false }: { passkeysEnabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await postJsonSafe<{ status?: string }>("/api/auth/login", {
        identifier,
        password,
      });
      if (!r.ok) {
        setError(r.error ?? t("common.error"));
        return;
      }
      const data = r.data;
      // mandatory 2FA: every login lands on the TOTP flow
      router.push(data.status === "2fa_setup" ? routes.twofaSetup : routes.twofaChallenge);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-identifier">{t("auth.identifier")}</Label>
        <Input
          id="login-identifier"
          type="text"
          autoComplete="username"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t("auth.identifierPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">{t("auth.password")}</Label>
          <Link href={routes.forgotPassword} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            {t("auth.forgot")}
          </Link>
        </div>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("common.loading") : t("auth.submitLogin")}
      </Button>
      {passkeysEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("auth.orContinue")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <PasskeyButton />
        </>
      ) : null}
    </form>
  );
}
