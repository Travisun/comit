import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Dashboard route-group guard — authentication / 2FA / email-verification
 * only. The console chrome (sidebar + topbar) is rendered per section:
 * admin/* uses AdminNav. User-owned pages (write / settings) live in the
 * (site) group with the front X-style shell instead of a console.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/auth/login");
  if (auth.pending2fa) redirect("/auth/2fa/challenge");
  if (!auth.user.emailVerifiedAt) redirect("/auth/verify");

  return <>{children}</>;
}
