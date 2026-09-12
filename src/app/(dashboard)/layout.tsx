import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/index.server";
import { getSetting } from "@/lib/settings";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export const dynamic = "force-dynamic";

/**
 * Console shell — Cloudflare-dashboard style: full-width top bar (brand +
 * breadcrumb + bell + avatar menu) over a sticky left sidebar; the sidebar
 * collapses into a slide-in drawer on mobile. Shared by 写文章 / 我的文章 /
 * 账户设置. Pages bring their own content padding/width.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/auth/login");
  if (auth.pending2fa) redirect("/auth/2fa/challenge");
  if (!auth.user.emailVerifiedAt) redirect("/auth/verify");
  const locale = await getLocale();
  const showSubdomain = await getSetting("site.subdomains");

  return (
    <DashboardNav
      displayName={auth.user.displayName}
      username={auth.user.username}
      avatarPath={auth.user.avatarPath}
      showSubdomain={showSubdomain}
      locale={locale}
    >
      {children}
    </DashboardNav>
  );
}
