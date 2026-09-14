import { redirect } from "next/navigation";
import { and, count, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { MessageCircle } from "lucide-react";
import { db } from "@/db";
import { conversations, messages, notifications } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { routes } from "@/core/routes";
import { MessagesShell } from "@/components/social/messages-shell";

export const metadata = { title: "消息 / Inbox" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);
  const [{ t }, { tab: tabParam }] = await Promise.all([getT(), searchParams]);
  const tab = tabParam === "notifications" ? "notifications" : "dms";

  // unread counters for the inbox tabs (best-effort)
  const convIds = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)));
  const [[dmRow], [nRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, convIds),
          ne(messages.senderId, user.id),
          isNull(messages.readAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  ]);

  return (
    <MessagesShell tab={tab} unreadDms={dmRow.n} unreadNotifications={nRow.n}>
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessageCircle className="size-8" />
        <p className="text-sm">{t("messages.empty")}</p>
      </div>
    </MessagesShell>
  );
}
