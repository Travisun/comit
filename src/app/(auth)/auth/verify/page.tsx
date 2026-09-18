import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleX } from "lucide-react";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { ResendForm } from "./resend-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "验证邮箱 / Verify email" };

/**
 * 邮箱验证落地页三态：
 *  - ?verified=1 → 成功态：获得感反馈（图标 + 标语）+「继续登录」主 CTA
 *  - ?error=1    → 失效态：明确报错（链接无效或已过期）+ 重发表单 + 回登录引导
 *  - 无参数      → 提示态：等待用户去邮箱点击链接
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getT();
  const sp = await searchParams;
  const verified = sp.verified === "1";
  const invalid = sp.error === "1";

  if (verified) {
    return (
      <AuthCard title={t("auth.verifyEmail.title")}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="size-12 text-emerald-600" aria-hidden />
          <p className="text-lg font-semibold text-foreground">{t("auth.verifyEmail.success")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.verifiedHint")}</p>
          <Button asChild className="mt-2 w-full">
            <Link href={routes.login}>{t("auth.verifyEmail.continue")}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (invalid) {
    return (
      <AuthCard title={t("auth.verifyEmail.title")}>
        <AuthBanner tone="error">{t("auth.verifyEmail.invalid")}</AuthBanner>
        <p className="mb-4 mt-1 flex items-start gap-2 text-xs text-muted-foreground">
          <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("auth.verifyEmail.invalidHint")}
        </p>
        <ResendForm />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.verifyEmail.title")} description={t("auth.verifyEmail.sent")}>
      <ResendForm />
    </AuthCard>
  );
}
