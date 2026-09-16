import type { Metadata } from "next";
import { getT } from "@/lib/i18n";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = { title: "验证邮箱 / Verify email" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getT();
  const sp = await searchParams;
  const invalid = sp.error === "1";

  return (
    <AuthCard title={t("auth.verifyEmail.title")} description={t("auth.verifyEmail.sent")}>
      {invalid ? <AuthBanner tone="error">{t("auth.verifyEmail.invalid")}</AuthBanner> : null}
      <ResendForm />
    </AuthCard>
  );
}
