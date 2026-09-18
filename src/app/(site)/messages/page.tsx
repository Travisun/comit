import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { routes } from "@/core/routes";
import { MessagesShell } from "@/components/social/messages-shell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "消息 / Inbox" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);
  const { t } = await getT();

  return (
    <MessagesShell>
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageCircle className="size-10" />
        <p className="text-sm font-medium text-foreground">{t("messages.empty")}</p>
        <p className="max-w-56 text-center text-xs leading-relaxed">
          互相关注后即可私信。去发现页找到感兴趣的人，开始交流。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-1 rounded-full">
          <Link href={routes.explore}>去发现</Link>
        </Button>
      </div>
    </MessagesShell>
  );
}
