import type { Metadata } from "next";
import { requirePageRole } from "@/lib/permissions";
import TemplatesClient from "./templates-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "通知模板 · 管理后台",
  robots: { index: false, follow: false },
};

/** Admin-only: mail template center (registry, overrides, preview). */
export default async function AdminTemplatesPage() {
  await requirePageRole("admin.templates");
  return <TemplatesClient />;
}
