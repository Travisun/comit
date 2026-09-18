import { notFound, redirect } from "next/navigation";
import { and, eq, or } from "drizzle-orm";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { db } from "@/db";
import { blocks, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n";
import { isFollowing } from "@/lib/users";
import { routes } from "@/core/routes";
import { MessagesShell } from "@/components/social/messages-shell";
import { ChatClient } from "@/components/social/chat";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) notFound();

  const me = await getCurrentUser();
  if (!me) redirect(routes.login);
  const { t, locale } = await getT();
  if (userId === me.id) redirect(routes.messages);

  const [other] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarPath: users.avatarPath,
      dmEnabled: users.dmEnabled,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  if (!other) notFound();

  const [followsEachOther, blockedRow] = await Promise.all([
    Promise.all([isFollowing(me.id, other.id), isFollowing(other.id, me.id)]),
    db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, me.id), eq(blocks.blockedId, other.id)),
          and(eq(blocks.blockerId, other.id), eq(blocks.blockedId, me.id)),
        ),
      )
      .limit(1),
  ]);
  const allowed = followsEachOther[0] && followsEachOther[1] && other.dmEnabled
    && blockedRow.length === 0;

  return (
    <MessagesShell selectedUserId={other.id}>
      {allowed ? (
        <ChatClient
          other={{
            id: other.id,
            username: other.username,
            displayName: other.displayName,
            avatarPath: other.avatarPath,
          }}
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
            <Link
              href={routes.messages}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              {t("common.back")}
            </Link>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <ShieldAlert className="size-8" />
            <p className="text-sm">
              {other.dmEnabled && blockedRow.length === 0
                ? t("messages.mutualRequired")
                : locale === "zh"
                  ? "对方无法接收私信（已关闭私信或存在拉黑关系）"
                  : "This user cannot receive messages (DMs disabled or blocked)."}
            </p>
            <Link
              href={routes.profile(other.username)}
              className="text-sm font-medium text-primary hover:underline"
            >
              @{other.username}
            </Link>
          </div>
        </div>
      )}
    </MessagesShell>
  );
}
