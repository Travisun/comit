import type { Metadata } from "next";
import { getT } from "@/lib/i18n";
import { AuthCard } from "../_components/auth-card";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "找回密码 / Forgot password" };

export default async function ForgotPage() {
  const { t } = await getT();
  return (
    <AuthCard title={t("auth.forgot.title")}>
      <ForgotForm />
    </AuthCard>
  );
}
