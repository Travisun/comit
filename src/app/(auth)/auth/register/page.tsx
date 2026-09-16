import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";
import { AuthCard } from "../_components/auth-card";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "注册 / Sign up" };

export default async function RegisterPage() {
  const { t } = await getT();
  const inviteRequired = await getSetting("site.inviteRequired");

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
      <RegisterForm inviteRequired={inviteRequired} />
    </AuthCard>
  );
}
