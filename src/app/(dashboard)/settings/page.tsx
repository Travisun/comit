import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** /settings → flattened into the dashboard sidebar; land on profile. */
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
