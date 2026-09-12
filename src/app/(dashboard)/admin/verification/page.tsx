import type { Metadata } from "next";
import { requirePageRole } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/bits";
import { VerificationConsole } from "./console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "认证审核",
  robots: { index: false, follow: false },
};

/** Admin/editor console for user verification (V badge) requests. */
export default async function AdminVerificationPage() {
  await requirePageRole("admin.verification");

  return (
    <div>
      <PageHeader title="认证审核" description="用户 V 认证申请的审核、驳回与撤销" />
      <VerificationConsole />
    </div>
  );
}
