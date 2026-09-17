import { redirect } from "next/navigation";


/** Notifications live inside the unified inbox (私信 | 通知 tabs). */
export default async function NotificationsRedirect() {
  redirect("/messages?tab=notifications");
}
