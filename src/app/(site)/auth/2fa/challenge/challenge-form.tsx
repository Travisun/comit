"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { routes } from "@/core/routes";
import { postJsonSafe } from "@/lib/client/api";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../../_components/auth-card";

export function ChallengeForm() {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = mode === "totp" ? { code } : { recoveryCode: code };
      const r = await postJsonSafe("/api/auth/2fa/challenge", body);
      if (!r.ok) {
        setError(r.error ?? t("common.error"));
        return;
      }
      router.push(routes.home);
      router.refresh();
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
        <Label htmlFor="challenge-code">
          {mode === "totp" ? t("auth.2fa.code") : zh ? "恢复代码" : "Recovery code"}
        </Label>
        <Input
          id="challenge-code"
          type="text"
          required
          maxLength={mode === "totp" ? 6 : 32}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={mode === "totp" ? "000000" : "XXXXX-XXXXX"}
          className={mode === "totp" ? "text-center font-mono text-lg tracking-[0.4em]" : "font-mono"}
          autoComplete={mode === "totp" ? "one-time-code" : "off"}
          inputMode={mode === "totp" ? "numeric" : "text"}
        />
      </div>
      <Button type="submit" disabled={loading || !code.trim()} className="w-full">
        {loading ? t("common.loading") : t("common.confirm")}
      </Button>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => {
          setMode(mode === "totp" ? "recovery" : "totp");
          setCode("");
          setError(null);
        }}
      >
        {mode === "totp"
          ? zh
            ? "改用恢复代码登录"
            : "Use a recovery code instead"
          : zh
            ? "改用验证器验证码"
            : "Use an authenticator code instead"}
      </button>
    </form>
  );
}
