"use client";

import { useState } from "react";
import Link from "next/link";
import { routes } from "@/core/routes";
import { postJsonSafe } from "@/lib/client/api";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/primitives";
import { AuthBanner } from "../_components/auth-card";

function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

export function RegisterForm({ inviteRequired }: { inviteRequired: boolean }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
      const r = await postJsonSafe<{ message?: string }>("/api/auth/register", {
        email,
        username: username.toLowerCase(),
        displayName: displayName || undefined,
        password,
        inviteCode: inviteCode ? inviteCode : undefined,
        agree: true,
      });
      if (!r.ok) {
        setError(r.error ?? t("common.error"));
        return;
      }
      const data = r.data;
      setSuccess(data.message ?? t("auth.verifyEmail.sent"));
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col gap-4">
        <AuthBanner tone="success">{t("auth.verifyEmail.sent")}</AuthBanner>
        <Button asChild variant="outline" className="w-full">
          <Link href={routes.login}>{t("nav.login")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-email">{t("auth.email")}</Label>
        <Input
          id="reg-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-username">{t("auth.username")}</Label>
        <Input
          id="reg-username"
          type="text"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="alice"
          pattern="[a-z0-9][a-z0-9-]{1,62}"
          title="小写字母、数字、连字符 / lowercase letters, digits, hyphen"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-display-name">
          {t("auth.displayName")} <span className="text-xs text-muted-foreground">({t("common.optional")})</span>
        </Label>
        <Input
          id="reg-display-name"
          type="text"
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-password">{t("auth.password")}</Label>
        <Input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("auth.passwordWeak")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-confirm">{t("auth.confirmPassword")}</Label>
        <Input
          id="reg-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {inviteRequired ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-invite">{t("auth.inviteCode")}</Label>
          <Input
            id="reg-invite"
            type="text"
            required
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
        <label className="flex items-start gap-2">
          <Checkbox
            checked={agree}
            onCheckedChange={(v) => setAgree(v === true)}
            className="mt-0.5"
            aria-label="agree"
          />
          <span className="leading-relaxed">
            {t("auth.terms.agree")}
            <Link href={routes.legal.terms} target="_blank" className="text-primary hover:underline">
              {t("auth.terms.terms")}
            </Link>
            {t("auth.terms.and")}
            <Link href={routes.legal.privacy} target="_blank" className="text-primary hover:underline">
              {t("auth.terms.privacy")}
            </Link>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">{t("auth.terms.rights")}</p>
      </div>
      <Button type="submit" disabled={loading || !agree} className="w-full">
        {loading ? t("common.loading") : t("auth.submitRegister")}
      </Button>
    </form>
  );
}
