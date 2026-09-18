import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { routes } from "@/core/routes";
import { MessagesShell } from "@/components/social/messages-shell";
import { SystemChat } from "@/components/social/system-chat";

/**
 * System 会话页 — 系统通知抽象为「System 官方账号」的私信会话。
 * 静态段优先于 /messages/[userId] 动态路由，无需 UUID 校验/互关检查。
 */
export const metadata = { title: "System / 消息" };
export const dynamic = "force-dynamic";

export default async function SystemConversationPage() {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);

  return (
    <MessagesShell selectedUserId="system">
      <SystemChat />
    </MessagesShell>
  );
}
