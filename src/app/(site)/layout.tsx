import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, notifications } from "@/db/schema";
import { getAuth } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/index.server";
import { getSetting } from "@/lib/settings";
import { SiteShell, type ShellUser } from "@/components/site-shell";
import { SiteFooter } from "@/components/site-footer";
import { SiteRailSection } from "./_rail/rail-section";

/**
 * Public site chrome: X-style three-column shell — left icon/text nav,
 * 600px timeline column (rendered by each page), right rail ≥1280px,
 * mobile top bar + bottom tab bar. Dashboard-style routes (write / settings /
 * admin) live in the other route group and render full-screen without this.
 *
 * TTFB：主链只 await locale / 站点名 / 会话与导航未读数；右栏 rail
 * （topics/authors/stats + 本人计数，5 组查询）拆到 <SiteRailSection> 的
 * Suspense 边界里流式注入，骨架先行，不再阻塞整树首字节。
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  let siteName = "comit.sh";
  let user: ShellUser | null = null;
  try {
    siteName = await getSetting("site.name");
    const auth = await getAuth();
    if (auth && !auth.pending2fa && auth.user.emailVerifiedAt) {
      const uid = auth.user.id;
      const [[n], [m]] = await Promise.all([
        db
          .select({ n: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, uid), isNull(notifications.readAt))),
        db
          .select({ n: count() })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(
            and(
              or(eq(conversations.userAId, uid), eq(conversations.userBId, uid)),
              ne(messages.senderId, uid),
              isNull(messages.readAt),
            ),
          ),
      ]);
      user = {
        id: auth.user.id,
        username: auth.user.username,
        displayName: auth.user.displayName,
        avatarPath: auth.user.avatarPath,
        role: auth.user.role,
        unreadNotifications: n.n,
        unreadMessages: m.n,
      };
    }
  } catch (err) {
    console.error("[site-layout] db not ready:", (err as Error).message);
  }

  return (
    <SiteShell
      user={user}
      locale={locale}
      siteName={siteName}
      rail={<SiteRailSection user={user} siteName={siteName} />}
      footer={<SiteFooter locale={locale} />}
    >
      {children}
    </SiteShell>
  );
}
