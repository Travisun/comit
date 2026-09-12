import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, notifications } from "@/db/schema";
import { getAuth } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/index.server";
import { getSetting } from "@/lib/settings";
import { SiteShell, type ShellUser } from "@/components/site-shell";
import { SiteRail } from "@/components/site-rail";
import { SiteFooter } from "@/components/site-footer";
import {
  getActiveAuthors,
  getCommunityStats,
  getTrendingTopics,
} from "@/components/user-space/queries";
import type { AuthorCardData, TopicRef } from "@/components/user-space/types";

/**
 * Public site chrome: X-style three-column shell — left icon/text nav,
 * 600px timeline column (rendered by each page), right rail ≥1280px,
 * mobile top bar + bottom tab bar. Dashboard-style routes (write / settings /
 * admin) live in the other route group and render full-screen without this.
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

  // right rail data (topics / authors / community stats) — best-effort
  let topics: TopicRef[] = [];
  let authors: AuthorCardData[] = [];
  let stats: Awaited<ReturnType<typeof getCommunityStats>> | null = null;
  try {
    [topics, authors, stats] = await Promise.all([
      getTrendingTopics(7),
      getActiveAuthors(3),
      getCommunityStats(),
    ]);
  } catch {
    // db not ready — rail renders without data cards
  }

  return (
    <SiteShell
      user={user}
      locale={locale}
      siteName={siteName}
      rail={<SiteRail siteName={siteName} topics={topics} authors={authors} stats={stats} />}
      footer={<SiteFooter locale={locale} />}
    >
      {children}
    </SiteShell>
  );
}
