import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, type Role } from "@/lib/permissions";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "管理后台",
  robots: { index: false, follow: false },
};

/**
 * Admin shell — same Cloudflare-dashboard console as the creator center
 * (top bar + left rail + mobile drawer). Admins see everything; editors get
 * the moderation console only. Pages render inside a centered, padded column.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");
  const role = user.role as Role;
  if (!can(role, "admin.access")) redirect("/");

  return (
    <AdminNav
      role={role}
      displayName={user.displayName}
      username={user.username}
      avatarPath={user.avatarPath}
    >
      {children}
    </AdminNav>
  );
}
