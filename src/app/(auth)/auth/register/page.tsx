import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { OAuthButtons } from "../_components/oauth-buttons";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "注册 / Sign up" };

export default async function RegisterPage() {
  const { t } = await getT();
  const inviteRequired = await getSetting("site.inviteRequired");
  // 后台关闭密码注册（仅 OSS）时隐藏邮箱表单，改走第三方注册
  const passwordAuth = await getSetting("auth.passwordAuth");

  return (
    <AuthCard
      title={t("auth.register.title")}
      description={t("auth.register.subtitle")}
      footer={
        <span>
          {t("auth.hasAccount")}{" "}
          <Link href={routes.login} className="text-primary hover:underline">
            {t("nav.login")}
          </Link>
        </span>
      }
    >
      {!passwordAuth ? (
        <AuthBanner tone="info">站点已开启仅第三方注册，请使用下方方式继续 / This site accepts federated sign-up only</AuthBanner>
      ) : (
        <RegisterForm inviteRequired={inviteRequired} />
      )}
      {!passwordAuth && <OAuthButtons />}
    </AuthCard>
  );
}
