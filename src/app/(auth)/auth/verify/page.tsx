import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleX } from "lucide-react";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getAuth } from "@/lib/auth/session";
import { maskEmail } from "@/app/api/me/_shared";
import { AuthCard, AuthBanner } from "../_components/auth-card";
import { ResendForm } from "./resend-form";
import { SessionVerifyActions } from "./session-verify-actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "验证邮箱 / Verify email" };

/**
 * 邮箱验证落地页四态：
 *  - ?verified=1          → 成功态：获得感反馈（图标 + 标语）+「继续登录」主 CTA
 *  - ?error=1             → 失效态：明确报错（链接无效或已过期）+ 重发表单 + 回登录引导
 *  - 已登录且邮箱未验证    → 会话态：展示当前邮箱 + 重发 + 验证前换绑
 *                           （仪表盘硬门槛把未验证用户重定向到本页，见
 *                           (dashboard)/layout.tsx —— 此前该页只有匿名表单，
 *                           注册邮箱填错或 OSS 合成邮箱会永久死锁）
 *  - 无参数且未登录       → 提示态：等待用户去邮箱点击链接
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
    // 成功态 CTA 分流：已登录用户（会话内换绑/重发后验证）直接进站或回
    // onboarding；匿名用户（点邮件链接验证）走原「继续登录」。
    const auth = await getAuth();
    const authed = Boolean(auth && !auth.pending2fa);
    const ctaHref = authed
      ? auth!.user.onboardedAt
        ? routes.home
        : "/onboarding"
      : routes.login;
    const ctaLabel = authed ? t("auth.verifyEmail.enterSite") : t("auth.verifyEmail.continue");
    return (
      <AuthCard title={t("auth.verifyEmail.title")}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="size-12 text-emerald-600" aria-hidden />
          <p className="text-lg font-semibold text-foreground">{t("auth.verifyEmail.success")}</p>
          <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.verifiedHint")}</p>
          <Button asChild className="mt-2 w-full">
            <Link href={ctaHref}>{ctaLabel}</Link>
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

  // 会话态：登录 + 2FA 已完成的未验证用户（/auth/verify 硬门槛的落点）
  const auth = await getAuth();
  if (auth && !auth.pending2fa && !auth.user.emailVerifiedAt) {
    return (
      <AuthCard title={t("auth.verifyEmail.title")} description={t("auth.verifyEmail.pendingDesc")}>
        <SessionVerifyActions
          email={maskEmail(auth.user.email)}
          hasPassword={Boolean(auth.user.passwordHash)}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.verifyEmail.title")} description={t("auth.verifyEmail.sent")}>
      <ResendForm />
    </AuthCard>
  );
}
