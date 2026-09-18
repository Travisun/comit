"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { routes } from "@/core/routes";
import { apiGet, postJsonSafe } from "@/lib/client/api";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { AuthBanner } from "../_components/auth-card";

/**
 * 「使用通行密钥登录」：无标识符的可发现凭据流程 —— 拉取 options（challenge
 * 落 HttpOnly cookie）→ 浏览器 WebAuthn 仪式 → 服务端验证建会话。
 * 2FA 语义与密码登录一致：返回 status 决定去挑战页还是设置页。
 */
export function PasskeyButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPasskey() {
    setError(null);
    setLoading(true);
    try {
      const options = await apiGet<Record<string, unknown>>("/api/auth/passkeys/login/options");
      const response = await startAuthentication({
        optionsJSON: options as never,
      });
      const r = await postJsonSafe<{ status?: string }>("/api/auth/passkeys/login", { response });
      if (!r.ok) {
        setError(r.error ?? t("common.error"));
        return;
      }
      router.push(r.data.status === "2fa_setup" ? routes.twofaSetup : routes.twofaChallenge);
    } catch (e) {
      // 用户取消仪式（NotAllowedError）不打扰：静默复位即可
      if (e instanceof Error && e.name === "NotAllowedError") return;
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <AuthBanner tone="error">{error}</AuthBanner> : null}
      <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={onPasskey}>
        <Fingerprint className="size-4" />
        {loading ? t("common.loading") : t("auth.passkey.login")}
      </Button>
    </div>
  );
}
