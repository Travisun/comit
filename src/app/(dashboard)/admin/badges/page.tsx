import type { Metadata } from "next";
import { requirePageRole } from "@/lib/permissions";
import { PageHeader } from "@/components/admin/bits";
import { BadgesConsole } from "./console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "徽章管理",
  robots: { index: false, follow: false },
};

/** 管理员徽章控制台：定制徽章、颁发/撤销。 */
export default async function AdminBadgesPage() {
  await requirePageRole("admin.badges");

  return (
    <div>
      <PageHeader title="徽章管理" description="定制徽章头衔并颁发给社区成员" />
      <BadgesConsole />
    </div>
  );
}
