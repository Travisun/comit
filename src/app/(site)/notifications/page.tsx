import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/core/routes";
import { TimelineHeader } from "@/components/site-shell";
import { NotificationList } from "@/components/social/notification-list";

export const metadata = { title: "通知 / Notifications" };

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);

  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      <TimelineHeader title="通知" />
      <NotificationList />
    </div>
  );
}
