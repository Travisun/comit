"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { postJsonSafe } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { AuthBanner } from "../_components/auth-card";

/**
 * 验证页会话态操作区：向当前（脱敏）邮箱重发验证邮件，或换绑新邮箱后再发。
 * 换绑对有密码账户要求输入当前密码（与 /api/me/email 的安全基线一致）；
 * 纯 OSS 账户没有密码可验，隐藏密码框。限频由服务端 auth.verifyEmail 桶管。
 */
export function SessionVerifyActions({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(payload: { newEmail?: string; password?: string }) {
    setError(null);
    setLoading(true);
    try {
      const r = await postJsonSafe("/api/me/verify-email", payload);
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
    <div className="flex flex-col gap-4">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <p className="text-sm text-muted-foreground">
        {t("auth.verifyEmail.pendingTo")} <span className="font-medium text-foreground">{email}</span>
      </p>
      <Button onClick={() => submit({})} disabled={loading} className="w-full">
        {loading ? t("common.loading") : t("auth.verifyEmail.resend")}
      </Button>

      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => setChangeOpen((v) => !v)}
      >
        {changeOpen ? t("auth.verifyEmail.changeHide") : t("auth.verifyEmail.changeShow")}
      </button>

      {changeOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit({ newEmail, password: password || undefined });
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verify-new-email">{t("auth.verifyEmail.newEmail")}</Label>
            <Input
              id="verify-new-email"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {hasPassword ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-password">{t("auth.verifyEmail.currentPassword")}</Label>
              <Input
                id="verify-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          ) : null}
          <Button type="submit" variant="outline" disabled={loading} className="w-full">
            {loading ? t("common.loading") : t("auth.verifyEmail.changeSubmit")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
