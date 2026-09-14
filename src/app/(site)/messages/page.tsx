import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { routes } from "@/core/routes";
import { MessagesShell } from "@/components/social/messages-shell";

export const metadata = { title: "消息 / Inbox" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);
  const { t } = await getT();

  return (
    <MessagesShell>
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessageCircle className="size-8" />
        <p className="text-sm">{t("messages.empty")}</p>
      </div>
    </MessagesShell>
  );
}
