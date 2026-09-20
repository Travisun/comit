import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getAuth } from "@/lib/auth/session";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "欢迎加入 / Welcome", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * 注册后引导（/onboarding）：昵称签名 → 头像 → 封面 → 第一条动态。
 * 各步可跳过；完成（或跳过到底）写 users.onboardedAt 后回首页。
 * 登录链路（2FA confirm / challenge 通过且未引导）会带到这里。
 */
export default async function OnboardingPage() {
  const auth = await getAuth();
  if (!auth || auth.pending2fa) redirect(routes.login);
  // 未验证用户先完成邮箱验证（此前误踢回 /login，造成「2FA 后被登出」的死循环观感）
  if (!auth.user.emailVerifiedAt) redirect(routes.verifyEmail);
  if (auth.user.onboardedAt) redirect(routes.home);

  return (
    <OnboardingWizard
      initial={{
        displayName: auth.user.displayName,
        bio: auth.user.bio ?? "",
        username: auth.user.username,
        avatarPath: auth.user.avatarPath,
        coverPath: auth.user.coverPath,
      }}
    />
  );
}
