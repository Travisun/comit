import type { Metadata } from "next";
import { getT } from "@/lib/i18n";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "重置密码 / Reset password" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getT();
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";

  return (
    <AuthCard title={t("auth.reset.title")}>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <AuthBanner tone="error">重置链接无效 / Invalid reset link</AuthBanner>
      )}
    </AuthCard>
  );
}
