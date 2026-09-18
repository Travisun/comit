import { redirect } from "next/navigation";


/** Notifications live inside the inbox as the pinned System conversation. */
export default async function NotificationsRedirect() {
  redirect("/messages/system");
}
