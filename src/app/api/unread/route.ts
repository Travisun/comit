import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, follows, notifications, posts } from "@/db/schema";
import { ok, withApi } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/unread?latest=<ts>&following=<ts>&messages=<ts>
 * 左侧导航本地未读标识的单一数据源：客户端带上各入口「上次浏览时间」，
 * 服务端一次查询返回三个计数（相对时间戳的新增条数）。
 * latest 为公开数据（匿名也可用）；following/messages 需要登录。
 */
export async function GET(req: Request) {
  // withApi：同源校验（GET 无操作）+ 维护模式守卫（GET 豁免）+ 错误统一 envelope
  return withApi(req, async () => {
    const url = new URL(req.url);
    const ts = (key: string): Date | null => {
      const raw = Number(url.searchParams.get(key) ?? 0);
      return Number.isFinite(raw) && raw > 0 ? new Date(raw) : null;
    };
    const latestTs = ts("latest");
    const followingTs = ts("following");
    const messagesTs = ts("messages");

    let latest = 0;
    if (latestTs) {
      const [row] = await db
        .select({ n: count() })
        .from(posts)
        .where(and(eq(posts.status, "published"), eq(posts.visibility, "public"), gt(posts.publishedAt, latestTs)));
      latest = Number(row?.n ?? 0);
    }

    const user = await getCurrentUser();
    let following = 0;
    let messages = 0;
    if (user) {
      if (followingTs) {
        const [row] = await db
          .select({ n: count() })
          .from(posts)
          .where(
            and(
              eq(posts.status, "published"),
              eq(posts.visibility, "public"),
              gt(posts.publishedAt, followingTs),
              inArray(
                posts.authorId,
                db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id)),
              ),
            ),
          );
        following = Number(row?.n ?? 0);
      }

      if (messagesTs) {
        // 我参与的会话中，最近消息晚于 seen 的会话数
        const [convN] = await db
          .select({ n: count() })
          .from(conversations)
          .where(
            and(
              gt(conversations.lastMessageAt, messagesTs),
              sql`(${conversations.userAId} = ${user.id} or ${conversations.userBId} = ${user.id})`,
            ),
          );
        // 我收到的、晚于 seen 的通知数
        const [notifN] = await db
          .select({ n: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, user.id), gt(notifications.createdAt, messagesTs)));
        messages = Number(convN?.n ?? 0) + Number(notifN?.n ?? 0);
      }
    }

    return ok({ latest, following, messages });
  });
}
