import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getAuth } from "@/lib/auth/session";
import { AuthCard } from "../../_components/auth-card";
import { ChallengeForm } from "./challenge-form";

export const metadata: Metadata = { title: "两步验证 / Two-factor authentication" };

export default async function TwofaChallengePage() {
  const auth = await getAuth();
  if (!auth) redirect(routes.login);
  // nothing pending ⇒ already signed in
  if (!auth.pending2fa) redirect(routes.home);

  const { t } = await getT();
  return (
    <AuthCard title={t("auth.2fa.title")} description={t("auth.2fa.subtitle")}>
      <ChallengeForm />
    </AuthCard>
  );
}
