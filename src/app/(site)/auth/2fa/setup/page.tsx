import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getAuth } from "@/lib/auth/session";
import { hasConfirmedTotp } from "@/lib/auth/totp";
import { AuthCard } from "../../_components/auth-card";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "绑定两步验证 / Set up 2FA" };

export default async function TwofaSetupPage() {
  const auth = await getAuth();
  if (!auth) redirect(routes.login);
  // fully enrolled users have nothing left to set up
  if (await hasConfirmedTotp(auth.user.id)) redirect(routes.home);

  const { t } = await getT();
  return (
    <AuthCard title={t("auth.2fa.setupTitle")} description={t("auth.2fa.setupSubtitle")}>
      <SetupForm />
    </AuthCard>
  );
}
