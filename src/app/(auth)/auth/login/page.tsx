import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { OAuthButtons } from "../_components/oauth-buttons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "登录 / Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getT();
  const sp = await searchParams;
  const verified = sp.verified === "1";
  const oauthError = typeof sp.error === "string" && sp.error.startsWith("oauth");
  // 第三方邮箱命中既有账户（不再自动登入）：给出明确的"先登录再绑定"指引
  const emailRegistered = sp.error === "oauth_email_registered";
  // 后台关闭密码登录（仅 OSS）时隐藏邮箱表单
  const passwordAuth = await getSetting("auth.passwordAuth");
  const passkeysEnabled = await getSetting("auth.passkeys");

  return (
    <AuthCard
      title={t("auth.login.title")}
      description={t("auth.login.subtitle")}
      footer={
        <span>
          {t("auth.noAccount")}{" "}
          <Link href={routes.register} className="text-primary hover:underline">
            {t("nav.register")}
          </Link>
        </span>
      }
    >
      {verified ? <AuthBanner tone="success">{t("auth.verifyEmail.success")}</AuthBanner> : null}
      {emailRegistered ? (
        <AuthBanner tone="error">
          该邮箱已被注册，出于账号安全，第三方登录不会自动登入陌生邮箱账户；请先用
          已注册方式登录，再到 设置 → 账号绑定 中绑定此第三方账号{" "}
          <Link href="/settings/connections" className="text-primary hover:underline">
            前往绑定
          </Link>
        </AuthBanner>
      ) : oauthError ? (
        <AuthBanner tone="error">
          第三方登录失败，请重试或使用邮箱登录 / Federated sign-in failed, please retry or use email
        </AuthBanner>
      ) : null}
      {!passwordAuth ? (
        <AuthBanner tone="info">站点已开启仅第三方登录，请使用下方方式继续 / This site accepts federated sign-in only</AuthBanner>
      ) : (
        <LoginForm passkeysEnabled={passkeysEnabled} />
      )}
      <OAuthButtons />
    </AuthCard>
  );
}
