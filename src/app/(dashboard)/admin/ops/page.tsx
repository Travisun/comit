import type { Metadata } from "next";
import { requirePageRole } from "@/lib/permissions";
import { OpsDashboard } from "./ops-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "运维监控",
  robots: { index: false, follow: false },
};

/** Ops dashboard — admin only (admin.ops). Read-only, no polling. */
export default async function AdminOpsPage() {
  await requirePageRole("admin.ops");
  return <OpsDashboard />;
}
